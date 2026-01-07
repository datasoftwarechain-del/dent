import { WorkOrderStatus } from '@/server/db/types';
import { z } from 'zod';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { supabaseAdmin } from '@/server/db/client';
import { updateWorkOrderStatus } from './work-order-service';
import { createInvoiceFromOrder } from './billing-service';
import { sendEmail } from '@/server/notifications/email';
import { sendWhatsAppMessage } from '@/server/notifications/whatsapp';
import { s3Client, createDownloadUrl } from '@/server/files/storage';
import { env } from '@/server/config';
import { logger } from '@/server/logger';

type CurrentUser = Parameters<typeof updateWorkOrderStatus>[1];

const deliverSchema = z.object({
  orderId: z.string().uuid()
});

const toAscii = (value: string | null | undefined) => {
  if (!value) return '';
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}+/gu, '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+\n/g, '\n')
    .trim();
};

const escapePdfText = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

const buildPdfBuffer = (lines: string[]) => {
  const sanitized = lines.map((line) => {
    const ascii = toAscii(line);
    return ascii.length > 0 ? ascii : ' ';
  });

  const textOps = sanitized
    .map((line, index) => {
      const escaped = escapePdfText(line);
      return index === 0 ? `(${escaped}) Tj` : `T* (${escaped}) Tj`;
    })
    .join('\n');

  const contentStream = `BT
/F1 12 Tf
12 TL
1 0 0 1 50 760 Tm
${textOps}
ET`;

  const contentBuffer = Buffer.from(contentStream, 'utf8');
  const header = '%PDF-1.4\n';
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${contentBuffer.length} >>\nstream\n${contentBuffer.toString('utf8')}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n'
  ];

  const body = objects.join('');
  let offset = header.length;
  const xrefEntries = ['0000000000 65535 f \n'];

  for (const object of objects) {
    xrefEntries.push(`${String(offset).padStart(10, '0')} 00000 n \n`);
    offset += Buffer.byteLength(object, 'utf8');
  }

  const xref = `xref
0 ${objects.length + 1}
${xrefEntries.join('')}`;

  const trailer = `trailer
<< /Size ${objects.length + 1} /Root 1 0 R >>
startxref
${header.length + Buffer.byteLength(body, 'utf8')}
%%EOF`;

  const pdfString = header + body + xref + trailer;
  return Buffer.from(pdfString, 'utf8');
};

const uploadInvoicePdf = async (orderId: string, pdf: Buffer) => {
  if (!env.S3_BUCKET) return null;

  const key = `invoices/${orderId}-${Date.now()}.pdf`;

  try {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: pdf,
        ContentType: 'application/pdf'
      })
    );

    const url = await createDownloadUrl(key);
    return { key, url };
  } catch (error) {
    logger.warn({ error, orderId }, 'Failed to upload invoice PDF to S3');
    return null;
  }
};

const formatCurrency = (value: number, currency = 'ARS') => {
  const numeric = Number(value ?? 0);
  try {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency
    }).format(numeric);
  } catch {
    return `${currency} ${numeric.toFixed(2)}`;
  }
};

const buildWhatsAppBody = (
  order: { displayCode: string | null; code: string; sequentialNumber: number | null; patient: { name: string | null } | null },
  invoice: { amount: number; currency: string },
  downloadUrl?: string | null
) => {
  const parts = [
    `Factura ${order.displayCode ?? order.code}`,
    `Monto: ${formatCurrency(invoice.amount, invoice.currency)}`,
    order.patient?.name ? `Paciente: ${order.patient.name}` : null,
    downloadUrl ? `Descarga: ${downloadUrl}` : 'Disponible en el portal DigitalDent.'
  ].filter(Boolean);

  return parts.join('\n');
};

const buildEmailBody = (
  clientName: string | null | undefined,
  order: { displayCode: string | null; code: string; sequentialNumber: number | null; patient: { name: string | null } | null },
  invoice: { amount: number; currency: string }
) => {
  const greeting = clientName ? `Hola ${clientName},` : 'Hola,';
  const lines = [
    greeting,
    '',
    `Adjuntamos la factura del trabajo ${order.displayCode ?? order.code}.`,
    `Monto: ${formatCurrency(invoice.amount, invoice.currency)}.`,
    order.patient?.name ? `Paciente: ${order.patient.name}.` : null,
    '',
    'Gracias por confiar en DigitalDent.'
  ].filter(Boolean);

  return lines.join('\n');
};

const buildInvoicePdf = (params: {
  order: {
    displayCode: string | null;
    code: string;
    sequentialNumber: number | null;
    dueDate: Date | null;
    workType: string | null;
    patient: { name: string | null } | null;
    dentist: { name: string | null } | null;
    client: { name: string | null } | null;
  };
  invoice: {
    id: string;
    amount: number;
    currency: string;
    createdAt: Date;
  };
}) => {
  const { order, invoice } = params;
  const lines = [
    'DigitalDent - Comprobante de Trabajo',
    '',
    `Factura: ${invoice.id}`,
    `Orden: ${order.displayCode ?? order.code}`,
    order.sequentialNumber !== null ? `Número interno: ${order.sequentialNumber}` : null,
    order.client?.name ? `Cliente: ${order.client.name}` : null,
    order.patient?.name ? `Paciente: ${order.patient.name}` : null,
    order.dentist?.name ? `Profesional: ${order.dentist.name}` : null,
    order.dueDate ? `Entrega estimada: ${order.dueDate.toLocaleDateString('es-AR')}` : null,
    order.workType ? `Tipo de trabajo: ${order.workType}` : null,
    '',
    `Monto: ${formatCurrency(invoice.amount, invoice.currency)}`,
    `Fecha de emisión: ${invoice.createdAt.toLocaleDateString('es-AR')}`,
    '',
    'Gracias por elegir DigitalDent'
  ].filter(Boolean) as string[];

  return buildPdfBuffer(lines);
};

export const markOrderAsDelivered = async (
  orderId: string,
  currentUser?: CurrentUser
) => {
  const { orderId: validatedOrderId } = deliverSchema.parse({ orderId });

  const updated = await updateWorkOrderStatus(
    {
      workOrderId: validatedOrderId,
      status: WorkOrderStatus.DELIVERED,
      message: 'Orden marcada como entregada'
    },
    currentUser
  );

  let { data: invoice } = await supabaseAdmin
    .from('invoices')
    .select('id,clientId,amount,currency,createdAt')
    .eq('workOrderId', validatedOrderId)
    .order('createdAt', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!invoice) {
    const created = await createInvoiceFromOrder(validatedOrderId);
    invoice = created;
  }

  if (!invoice) {
    throw new Error('No se pudo generar la factura asociada a la orden');
  }

  const { data: client } = await supabaseAdmin
    .from('user_profiles')
    .select('id,email,name,phone')
    .eq('id', invoice.clientId)
    .maybeSingle();

  const pdfBuffer = buildInvoicePdf({
    order: {
      displayCode: updated.displayCode ?? null,
      code: updated.code,
      sequentialNumber:
        typeof updated.sequentialNumber === 'number' ? updated.sequentialNumber : null,
      dueDate: updated.dueDate ? new Date(updated.dueDate) : null,
      workType: updated.workType ?? null,
      patient: updated.patient ?? null,
      dentist: updated.dentist ?? null,
      client: updated.client ?? null
    },
    invoice: {
      id: invoice.id,
      amount: Number(invoice.amount ?? 0),
      currency: invoice.currency ?? 'ARS',
      createdAt: new Date(invoice.createdAt)
    }
  });

  const upload = await uploadInvoicePdf(validatedOrderId, pdfBuffer);

  const notifications = {
    whatsapp: {
      attempted: false,
      sent: false,
      error: undefined as string | undefined
    },
    email: {
      attempted: false,
      sent: false,
      error: undefined as string | undefined
    }
  };

  const clientPhone = client?.phone ?? null;

  if (clientPhone) {
    notifications.whatsapp.attempted = true;
    const whatsappResult = await sendWhatsAppMessage({
      to: clientPhone,
      body: buildWhatsAppBody(
        {
          displayCode: updated.displayCode ?? null,
          code: updated.code,
          sequentialNumber:
            typeof updated.sequentialNumber === 'number' ? updated.sequentialNumber : null,
          patient: updated.patient ?? null
        },
        {
          amount: Number(invoice.amount ?? 0),
          currency: invoice.currency ?? 'ARS'
        },
        upload?.url
      ),
      mediaUrl: upload?.url ?? undefined
    });

    notifications.whatsapp.sent = whatsappResult.sent;
    if (whatsappResult.error) {
      notifications.whatsapp.error = whatsappResult.error;
    }
  }

  if (!notifications.whatsapp.sent) {
    const email = client?.email ?? null;
    if (email) {
      notifications.email.attempted = true;
      try {
        await sendEmail({
          to: email,
          subject: `Factura ${updated.displayCode ?? updated.code}`,
          text: buildEmailBody(client?.name, updated, {
            amount: Number(invoice.amount ?? 0),
            currency: invoice.currency ?? 'ARS'
          }),
          attachments: [
            {
              filename: `Factura-${updated.displayCode ?? updated.code}.pdf`,
              content: pdfBuffer,
              contentType: 'application/pdf'
            }
          ]
        });
        notifications.email.sent = true;
      } catch (error) {
        logger.error(
          { error, orderId: validatedOrderId },
          'Failed to send invoice email notification'
        );
        notifications.email.error =
          error instanceof Error ? error.message : 'email-send-failure';
      }
    } else {
      notifications.email.error = 'Cliente sin email registrado';
    }
  }

  return {
    order: updated,
    invoice: {
      id: invoice.id,
      amount: String(invoice.amount ?? '0'),
      currency: invoice.currency ?? 'ARS',
      createdAt: invoice.createdAt
    },
    pdf: {
      uploaded: Boolean(upload?.url),
      url: upload?.url ?? null,
      key: upload?.key ?? null
    },
    notifications
  };
};
