const { MercadoPagoConfig, Payment } = require('mercadopago');

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
  options: { timeout: 8000 }
});

// Confirma con Mercado Pago que un pago está aprobado (el cliente no puede falsificarlo)
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const id = String((req.query && req.query.id) || '');
  if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'id inválido' });

  try {
    const p = await new Payment(client).get({ id });
    let pedido = null;
    try { pedido = p.metadata && p.metadata.pedido ? JSON.parse(p.metadata.pedido) : null; } catch (e) {}
    return res.status(200).json({
      status: p.status,
      external_reference: p.external_reference,
      transaction_amount: p.transaction_amount,
      installments: p.installments,
      pedido
    });
  } catch (error) {
    console.error('verify-payment:', error);
    return res.status(500).json({ error: error.message || 'No se pudo verificar' });
  }
};
