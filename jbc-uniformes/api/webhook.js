const { MercadoPagoConfig, Payment } = require('mercadopago');

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

const WA_NUMBER = process.env.WA_NUMBER || '5493416850004';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { type, data } = req.body;

    if (type !== 'payment') return res.status(200).json({ ok: true });

    const payment = new Payment(client);
    const result = await payment.get({ id: data.id });

    const status = result.status;
    const orderRef = result.external_reference || '';
    const amount = result.transaction_amount;
    const payerName = result.payer?.first_name || 'Cliente';
    const payerPhone = result.payer?.phone?.number || '';

    if (status === 'approved') {
      // Armar mensaje WhatsApp
      const msg =
`✅ *PAGO CONFIRMADO - JBC Uniformes*

🧾 *Pedido:* ${orderRef}
👤 *Cliente:* ${payerName}
📞 *Teléfono:* ${payerPhone}
💰 *Monto pagado:* $ ${Number(amount).toLocaleString('es-AR')}
🏦 *Estado:* APROBADO ✅

_Notificación automática de Mercado Pago_`;

      const waUrl = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(msg)}`;
      console.log('Pago aprobado:', orderRef, amount);
      console.log('WA URL:', waUrl);
    }

    return res.status(200).json({ ok: true, status });

  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: error.message });
  }
};
