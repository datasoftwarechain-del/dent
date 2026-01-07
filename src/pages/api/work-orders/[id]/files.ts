import type { APIRoute } from 'astro';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { ZodError, z } from 'zod';
import { WorkOrderFileType } from '@/server/db/types';
import {
  canUploadWorkOrderFiles,
  workOrderScopeForUser
} from '@/server/auth/permissions';
import { supabaseAdmin } from '@/server/db/client';
import { createPresignedUpload, buildS3ObjectUrl, ensureS3Ready } from '@/server/utils/s3';

const payloadSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1).max(200),
  size: z.number().int().positive().max(200 * 1024 * 1024),
  kind: z.nativeEnum(WorkOrderFileType).default(WorkOrderFileType.OTHER)
});

export const POST: APIRoute = async ({ params, request, locals }) => {
  try {
    const user = locals.user;
    if (!user?.id) {
      return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      });
    }

    if (!canUploadWorkOrderFiles(user)) {
      return new Response(JSON.stringify({ ok: false, error: 'forbidden' }), {
        status: 403,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      });
    }

    const workOrderId = String(params.id ?? '').trim();
    if (!/^[0-9a-fA-F-]{36}$/.test(workOrderId)) {
      return new Response(JSON.stringify({ ok: false, error: 'invalid_id' }), {
        status: 400,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      });
    }

    ensureS3Ready();

    const payload = payloadSchema.parse(await request.json());
    const scope = workOrderScopeForUser({ id: user.id, role: user.role });

    let workOrderQuery = supabaseAdmin
      .from('work_orders')
      .select('id')
      .eq('id', workOrderId);

    if (scope?.eq) {
      for (const [key, value] of Object.entries(scope.eq)) {
        if (value) {
          workOrderQuery = workOrderQuery.eq(key, value);
        }
      }
    }

    if (scope?.or) {
      workOrderQuery = workOrderQuery.or(scope.or);
    }

    const { data: workOrder, error: workOrderError } = await workOrderQuery.maybeSingle();

    if (workOrderError) {
      return new Response(JSON.stringify({ ok: false, error: 'Server error' }), {
        status: 500,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      });
    }

    if (!workOrder) {
      return new Response(JSON.stringify({ ok: false, error: 'not_found' }), {
        status: 404,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      });
    }

    const extension = path.extname(payload.fileName);
    const key = `work-orders/${workOrderId}/${Date.now()}-${nanoid(6)}${extension ?? ''}`;

    const uploadUrl = await createPresignedUpload(
      key,
      payload.contentType || 'application/octet-stream'
    );

    const { data: stored, error: storedError } = await supabaseAdmin
      .from('work_order_files')
      .insert({
        workOrderId: workOrderId,
        kind: payload.kind,
        url: buildS3ObjectUrl(key),
        size: payload.size,
        mime: payload.contentType,
        uploadedBy: user.email ?? user.id
      })
      .select('*')
      .single();

    if (storedError || !stored) {
      return new Response(JSON.stringify({ ok: false, error: 'Server error' }), {
        status: 500,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        uploadUrl,
        file: {
          id: stored.id,
          workOrderId: stored.workOrderId,
          kind: stored.kind,
          url: stored.url,
          size: stored.size,
          mime: stored.mime,
          uploadedBy: stored.uploadedBy,
          createdAt: stored.createdAt ? new Date(stored.createdAt).toISOString() : null
        }
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      }
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return new Response(
        JSON.stringify({ ok: false, error: 'invalid_payload', issues: error.issues }),
        {
          status: 400,
          headers: { 'content-type': 'application/json; charset=utf-8' }
        }
      );
    }

    console.error('[work-orders/:id/files][POST] error', error);
    return new Response(JSON.stringify({ ok: false, error: 'Server error' }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }
};
