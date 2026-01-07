import { z } from 'zod';
import { supabaseAdmin } from '../db/client';

const toNumber = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const listProducts = async (search?: string) => {
  let query = supabaseAdmin.from('products').select('*').order('name', { ascending: true });

  if (search) {
    const escaped = search.replace(/%/g, '\\%').replace(/_/g, '\\_');
    query = query.or(
      `name.ilike.%${escaped}%,description.ilike.%${escaped}%,sku.ilike.%${escaped}%`
    );
  }

  const { data, error } = await query;
  if (error) {
    throw new Error('No se pudieron cargar los productos');
  }

  return data ?? [];
};

const cartItemSchema = z.object({
  productId: z.string().min(1),
  qty: z.number().int().positive()
});

export const addItemToCart = async (userId: string, payload: z.infer<typeof cartItemSchema>) => {
  const data = cartItemSchema.parse(payload);

  const { data: existingCart, error: cartError } = await supabaseAdmin
    .from('carts')
    .select('id,total')
    .eq('userId', userId)
    .maybeSingle();

  if (cartError) {
    throw new Error('No se pudo cargar el carrito');
  }

  const cart =
    existingCart ??
    (await supabaseAdmin
      .from('carts')
      .insert({ userId, total: 0 })
      .select('id,total')
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          throw new Error('No se pudo crear el carrito');
        }
        return data;
      }));

  const { data: product, error: productError } = await supabaseAdmin
    .from('products')
    .select('id,price')
    .eq('id', data.productId)
    .single();

  if (productError || !product) {
    throw new Error('Producto no encontrado');
  }

  const { data: existingItem } = await supabaseAdmin
    .from('cart_items')
    .select('id,qty')
    .eq('cartId', cart.id)
    .eq('productId', data.productId)
    .maybeSingle();

  if (existingItem) {
    const nextQty = toNumber(existingItem.qty) + data.qty;
    const { error: updateError } = await supabaseAdmin
      .from('cart_items')
      .update({ qty: nextQty })
      .eq('id', existingItem.id);

    if (updateError) {
      throw new Error('No se pudo actualizar el carrito');
    }
  } else {
    const { error: insertError } = await supabaseAdmin.from('cart_items').insert({
      cartId: cart.id,
      productId: data.productId,
      qty: data.qty,
      unitPrice: product.price
    });

    if (insertError) {
      throw new Error('No se pudo agregar el producto al carrito');
    }
  }

  const { data: items, error: itemsError } = await supabaseAdmin
    .from('cart_items')
    .select('id,qty,unitPrice,product:productId(*)')
    .eq('cartId', cart.id);

  if (itemsError) {
    throw new Error('No se pudieron cargar los items del carrito');
  }

  const total = (items ?? []).reduce(
    (acc, item) => acc + toNumber(item.unitPrice) * toNumber(item.qty),
    0
  );

  const { error: totalError } = await supabaseAdmin
    .from('carts')
    .update({ total })
    .eq('id', cart.id);

  if (totalError) {
    throw new Error('No se pudo actualizar el total del carrito');
  }

  return {
    cartId: cart.id,
    items: items ?? [],
    total
  };
};

export const clearCart = async (userId: string) => {
  const { data: cart, error: cartError } = await supabaseAdmin
    .from('carts')
    .select('id')
    .eq('userId', userId)
    .maybeSingle();

  if (cartError) {
    throw new Error('No se pudo cargar el carrito');
  }

  if (!cart) {
    return;
  }

  const { error: itemsError } = await supabaseAdmin
    .from('cart_items')
    .delete()
    .eq('cartId', cart.id);

  if (itemsError) {
    throw new Error('No se pudo limpiar el carrito');
  }

  const { error: updateError } = await supabaseAdmin
    .from('carts')
    .update({ total: 0 })
    .eq('id', cart.id);

  if (updateError) {
    throw new Error('No se pudo actualizar el carrito');
  }
};


export const getCart = async (userId: string) => {
  const { data: cart, error: cartError } = await supabaseAdmin
    .from('carts')
    .select('id,total')
    .eq('userId', userId)
    .maybeSingle();

  if (cartError) {
    throw new Error('No se pudo cargar el carrito');
  }

  if (!cart) {
    return null;
  }

  const { data: items, error: itemsError } = await supabaseAdmin
    .from('cart_items')
    .select('id,qty,unitPrice,product:productId(*)')
    .eq('cartId', cart.id);

  if (itemsError) {
    throw new Error('No se pudieron cargar los items del carrito');
  }

  return {
    ...cart,
    total: toNumber(cart.total),
    items: items ?? []
  };
};
