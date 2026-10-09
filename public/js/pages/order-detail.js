const { createApp, ref, onMounted } = Vue;

createApp({
  setup() {
    if (!Auth.requireAuth()) return {};

    const el = document.getElementById('app');
    const orderId = el.dataset.orderId;
    const paymentResult = ref(el.dataset.paymentResult || null);

    const order = ref(null);
    const loading = ref(true);
    const paying = ref(false);
    const verifying = ref(false);

    const statusMap = {
      pending: { label: '待付款', cls: 'bg-apricot/20 text-apricot' },
      paid: { label: '已付款', cls: 'bg-sage/20 text-sage' },
      failed: { label: '付款失敗', cls: 'bg-red-100 text-red-600' },
    };

    const paymentMessages = {
      success: { text: '付款成功！感謝您的購買。', cls: 'bg-sage/10 text-sage border border-sage/20' },
      failed: { text: '付款失敗，請重試。', cls: 'bg-red-50 text-red-600 border border-red-100' },
      cancel: { text: '付款已取消。', cls: 'bg-apricot/10 text-apricot border border-apricot/20' },
      unpaid: { text: '尚未收到付款結果。若您已完成付款，請稍候再按「查詢付款結果」；也可以重新前往付款。', cls: 'bg-apricot/10 text-apricot border border-apricot/20' },
    };

    // Full-page form POST to ECPay (the payment page cannot be embedded in an iframe)
    function submitToEcpay(action, params) {
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = action;
      Object.keys(params).forEach(function (key) {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = key;
        input.value = params[key];
        form.appendChild(input);
      });
      document.body.appendChild(form);
      form.submit();
    }

    async function handlePay() {
      if (!order.value || paying.value) return;
      paying.value = true;
      try {
        const res = await apiFetch('/api/orders/' + order.value.id + '/ecpay', { method: 'POST' });
        if (!res) return;
        submitToEcpay(res.data.action, res.data.params);
      } catch (e) {
        paying.value = false;
        Notification.show(e?.data?.message || '無法前往付款', 'error');
        // The order may have been confirmed as paid by the server
        await loadOrder();
      }
    }

    async function handleVerify() {
      if (!order.value || verifying.value) return;
      verifying.value = true;
      try {
        const res = await apiFetch('/api/orders/' + order.value.id + '/ecpay/verify', { method: 'POST' });
        if (!res) return;
        order.value = res.data;
        paymentResult.value = res.data.status === 'paid' ? 'success' : 'unpaid';
      } catch (e) {
        Notification.show(e?.data?.message || '查詢付款結果失敗', 'error');
      } finally {
        verifying.value = false;
      }
    }

    async function loadOrder() {
      const res = await apiFetch('/api/orders/' + orderId);
      if (res) order.value = res.data;
    }

    onMounted(async function () {
      try {
        await loadOrder();
      } catch (e) {
        Notification.show('載入訂單失敗', 'error');
      } finally {
        loading.value = false;
      }

      if (!order.value || order.value.status !== 'pending') return;

      if (paymentResult.value === 'start') {
        // Drop the query so going back to this page does not start another payment
        window.history.replaceState(null, '', window.location.pathname);
        handlePay();
      } else if (order.value.merchant_trade_no) {
        handleVerify();
      }
    });

    return { order, loading, paying, verifying, paymentResult, statusMap, paymentMessages, handlePay, handleVerify };
  }
}).mount('#app');
