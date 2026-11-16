// StorePulse — Multi-tenant Store Analytics Dashboard

const API_BASE = '/api';
let currentStore = null;
let authToken = localStorage.getItem('storepulse_token');
let salesChart = null;
let statusDonut = null;

// ============ INIT ============
document.addEventListener('DOMContentLoaded', () => {
  if (authToken) {
    verifyAuth();
  }

  // Navigation
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const page = item.dataset.page;
      if (page) navigateTo(page);
    });
  });
});

// ============ AUTH ============
function showLoginTab(tab) {
  document.querySelectorAll('.login-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.login-form').forEach(f => f.classList.add('hidden'));

  if (tab === 'login') {
    document.querySelector('.login-tab:first-child').classList.add('active');
    document.getElementById('loginForm').classList.remove('hidden');
  } else {
    document.querySelector('.login-tab:last-child').classList.add('active');
    document.getElementById('registerForm').classList.remove('hidden');
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const slug = document.getElementById('loginSlug').value.trim();
  const password = document.getElementById('loginPassword').value;

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, password })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Login failed');
      return;
    }

    authToken = data.token;
    localStorage.setItem('storepulse_token', authToken);
    currentStore = data.store;
    showDashboard();
  } catch (err) {
    alert('Login failed: ' + err.message);
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const name = document.getElementById('regName').value.trim();
  const slug = document.getElementById('regSlug').value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  const password = document.getElementById('regPassword').value;

  if (!slug) {
    alert('Invalid slug. Use only lowercase letters, numbers, and hyphens.');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, slug, password })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Registration failed');
      return;
    }

    authToken = data.token;
    localStorage.setItem('storepulse_token', authToken);
    currentStore = data.store;
    showDashboard();
  } catch (err) {
    alert('Registration failed: ' + err.message);
  }
}

async function verifyAuth() {
  try {
    const res = await fetch(`${API_BASE}/auth/verify`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error);
    }

    currentStore = data.store;
    showDashboard();
  } catch (err) {
    logout();
  }
}

function logout() {
  authToken = null;
  currentStore = null;
  localStorage.removeItem('storepulse_token');
  document.getElementById('loginPage').classList.remove('hidden');
  document.getElementById('dashboard').classList.add('hidden');
  document.getElementById('loginForm').reset();
  document.getElementById('registerForm').reset();
}

function showDashboard() {
  document.getElementById('loginPage').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  document.getElementById('storeNameDisplay').textContent = currentStore.name;
  document.getElementById('storeSlugDisplay').textContent = '@' + currentStore.slug;

  navigateTo('overview');
}

// ============ NAVIGATION ============
function navigateTo(page) {
  // Update nav active state
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
    if (item.dataset.page === page) item.classList.add('active');
  });

  // Show page
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById('page-' + page);
  if (target) target.classList.add('active');

  // Load page data
  switch (page) {
    case 'overview': loadOverview(); break;
    case 'orders': loadOrders(); break;
    case 'products': loadProducts(); break;
    case 'customers': loadCustomers(); break;
    case 'delivery-shipments': loadShipments(); break;
    case 'delivery-companies': loadCompanies(); break;
    case 'delivery-settings': initDeliverySettings(); break;
    case 'delivery-rates': initRatesPage(); break;
    case 'analytics': loadAnalytics(); break;
    case 'whatsapp': initWhatsAppPage(); break;
  }
}

function toggleDeliverySection() {
  const section = document.getElementById('deliverySection');
  const chevron = document.getElementById('deliveryChevron');
  section.classList.toggle('open');
  chevron.classList.toggle('open');
}

// ============ SUPABASE HELPERS ============
function getHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${authToken}`
  };
}

// ============ OVERVIEW ============
async function loadOverview() {
  try {
    const sid = currentStore.id;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekAgo = new Date(now.getTime() - 7*24*60*60*1000).toISOString();
    const thirtyDaysAgo = new Date(now.getTime() - 30*24*60*60*1000).toISOString();
    const ninetyDaysAgo = new Date(now.getTime() - 90*24*60*60*1000).toISOString();

    const response = await fetch(`/api/dashboard/overview?store_id=${sid}`);
    const data = await response.json();

    document.getElementById('statTodaySales').textContent = formatCurrency(data.todaySales || 0);
    document.getElementById('statWeekSales').textContent = formatCurrency(data.weekSales || 0);
    document.getElementById('statTodayOrders').textContent = data.todayOrders || 0;
    document.getElementById('statPending').textContent = data.pendingOrders || 0;
    document.getElementById('statOutForDelivery').textContent = data.outForDelivery || 0;
    document.getElementById('statDelivered').textContent = data.deliveredOrders || 0;
    document.getElementById('statAOV').textContent = formatCurrency(data.aov || 0);
    document.getElementById('statVisitors').textContent = data.liveVisitors || 0;

    // Sales chart last 7 days
    const salesMap = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i*24*60*60*1000);
      const key = d.toISOString().slice(0, 10);
      salesMap[key] = 0;
    }
    (data.orders || []).forEach(o => {
      const key = o.created_at.slice(0, 10);
      if (salesMap[key] !== undefined) salesMap[key] += (o.cod_amount || 0);
    });
    renderSalesChart(Object.entries(salesMap).map(([date, sales]) => ({ date, sales })));

    renderStatusDonut({
      'Pending Call': data.pendingOrders || 0,
      'Confirmed': data.confirmedOrders || 0,
      'Out for Delivery': data.outForDelivery || 0,
      'Delivered': data.deliveredOrders || 0
    });

    renderFunnel({
      visitors: data.visitors || 0,
      productViews: data.productViews || 0,
      addToCart: data.addToCart || 0,
      checkouts: data.orders || 0
    });

    renderTopCustomers(data.customers?.slice(0, 5) || []);
  } catch (err) {
    console.error('Failed to load overview:', err);
  }
}

function renderSalesChart(chartData) {
  const canvas = document.getElementById('salesChart');
  if (!canvas) return;

  if (salesChart) salesChart.destroy();

  const ctx = canvas.getContext('2d');
  salesChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: chartData.map(d => formatDate(d.date)),
      datasets: [{
        label: 'Sales (DZD)',
        data: chartData.map(d => d.sales),
        backgroundColor: 'rgba(217, 119, 6, 0.6)',
        borderColor: 'rgba(217, 119, 6, 1)',
        borderWidth: 1,
        borderRadius: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#78716C' }
        },
        x: {
          grid: { display: false },
          ticks: { color: '#78716C' }
        }
      }
    }
  });
}

function renderStatusDonut(statusData) {
  const canvas = document.getElementById('statusDonut');
  if (!canvas) return;

  if (statusDonut) statusDonut.destroy();

  const ctx = canvas.getContext('2d');
  statusDonut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: Object.keys(statusData),
      datasets: [{
        data: Object.values(statusData),
        backgroundColor: [
          'rgba(245, 158, 11, 0.8)',
          'rgba(59, 130, 246, 0.8)',
          'rgba(168, 162, 158, 0.8)',
          'rgba(34, 197, 94, 0.8)'
        ],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#A8A29E', padding: 15 }
        }
      }
    }
  });
}

function renderFunnel(funnel) {
  const container = document.getElementById('conversionFunnel');
  if (!container) return;

  const max = Math.max(funnel.visitors, funnel.productViews, funnel.addToCart, funnel.checkouts) || 1;
  const steps = [
    { label: 'Visitors', value: funnel.visitors },
    { label: 'Product Views', value: funnel.productViews },
    { label: 'Add to Cart', value: funnel.addToCart },
    { label: 'Checkouts', value: funnel.checkouts }
  ];

  container.innerHTML = steps.map(step => `
    <div class="funnel-step">
      <div class="funnel-label">${step.label}</div>
      <div class="funnel-bar">
        <div class="funnel-fill" style="width: ${(step.value / max * 100).toFixed(1)}%">
          <span class="funnel-count">${step.value}</span>
        </div>
      </div>
    </div>
  `).join('');
}

function renderTopCustomers(customers) {
  const container = document.getElementById('topCustomersList');
  if (!container) return;

  if (!customers.length) {
    container.innerHTML = '<p class="empty-state">No customer data yet</p>';
    return;
  }

  container.innerHTML = customers.map(c => `
    <div style="display: flex; justify-content: space-between; padding: 0.75rem 0; border-bottom: 1px solid var(--border);">
      <div>
        <div style="font-weight: 500;">${escapeHtml(c.name)}</div>
        <div style="font-size: 0.8125rem; color: var(--text-muted);">${escapeHtml(c.phone)}</div>
      </div>
      <div style="text-align: right;">
        <div style="font-weight: 600; color: var(--accent);">${formatCurrency(c.total_spend)}</div>
        <div style="font-size: 0.75rem; color: var(--text-dim);">${c.total_orders} orders</div>
      </div>
    </div>
  `).join('');
}

// ============ ORDERS ============
async function loadOrders() {
  try {
    const search = document.getElementById('orderSearch')?.value || '';
    const status = document.getElementById('orderStatusFilter')?.value || 'all';
    const res = await fetch(`/api/orders?status=${status}&search=${encodeURIComponent(search)}`, { headers: getHeaders() });
    const data = await res.json();
    const orders = data.orders || [];

    const tbody = document.getElementById('ordersTableBody');
    if (!tbody) return;

    if (!orders.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-row">No orders found</td></tr>';
      return;
    }

    tbody.innerHTML = orders.map(order => `
      <tr>
        <td><strong>${escapeHtml(order.order_number)}</strong><br><small style="color: var(--text-dim);">${formatDateTime(order.created_at)}</small></td>
        <td>${escapeHtml(order.customer_name)}</td>
        <td>${escapeHtml(order.customer_phone)}</td>
        <td>${escapeHtml(order.customer_wilaya || '-')}</td>
        <td><strong>${formatCurrency(order.cod_amount)}</strong></td>
        <td><span class="status-badge ${getStatusClass(order.status)}">${escapeHtml(order.status)}</span></td>
        <td>${order.tracking_number ? escapeHtml(order.tracking_number) : '-'}</td>
        <td>
          <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
            <select onchange="updateOrderStatus(${order.id}, this.value)" style="padding: 0.375rem; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 0.75rem;">
              <option value="">Set Status</option>
              <option value="Pending Call">Pending Call</option>
              <option value="Confirmed by Phone">Confirmed by Phone</option>
              <option value="Sent to Delivery">Sent to Delivery</option>
              <option value="Out for Delivery">Out for Delivery</option>
              <option value="Delivered">Delivered</option>
              <option value="Returned">Returned</option>
              <option value="Cancelled">Cancelled</option>
            </select>
            <button class="btn btn-sm btn-secondary" onclick="copyShippingDetails(${order.id})">Copy</button>
            <button class="btn btn-sm btn-secondary" onclick="whatsAppOrder('${order.order_number}')">WA</button>
            ${order.tracking_number ? `<button class="btn btn-sm btn-secondary" onclick="whatsAppTracking(${order.id})">Track WA</button>` : ''}
          </div>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Failed to load orders:', err);
  }
}

async function updateOrderStatus(orderId, status) {
  if (!status) return;
  try {
    await fetch(`/api/orders/${orderId}`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ status })
    });
    loadOrders();
  } catch (err) {
    alert('Failed to update order: ' + err.message);
  }
}

function copyShippingDetails(orderId) {
  // In a real app, fetch order details and copy to clipboard
  alert('Shipping details copied to clipboard');
}

function openNewOrderModal() {
  const content = `
    <form onsubmit="createOrder(event)" class="form-grid">
      <div class="form-group">
        <label>Customer Name *</label>
        <input type="text" id="orderCustomerName" required>
      </div>
      <div class="form-group">
        <label>Phone *</label>
        <input type="tel" id="orderCustomerPhone" required>
      </div>
      <div class="form-group">
        <label>Wilaya</label>
        <input type="text" id="orderWilaya">
      </div>
      <div class="form-group">
        <label>Commune</label>
        <input type="text" id="orderCommune">
      </div>
      <div class="form-group">
        <label>Delivery Type</label>
        <select id="orderDeliveryType">
          <option>Home Delivery</option>
          <option>Stop Desk</option>
        </select>
      </div>
      <div class="form-group">
        <label>Items *</label>
        <textarea id="orderItems" rows="3" required placeholder="e.g. 2x Dress S, 1x Jacket M"></textarea>
      </div>
      <div class="form-group">
        <label>COD Amount (DZD) *</label>
        <input type="number" id="orderCodAmount" required>
      </div>
      <div class="form-group">
        <label>Shipping Fee (DZD)</label>
        <input type="number" id="orderShippingFee" value="0">
      </div>
      <button type="submit" class="btn btn-primary btn-full">Create Order</button>
    </form>
  `;
  showModal('New Order', content);
}

async function createOrder(e) {
  e.preventDefault();
  const body = {
    customer_name: document.getElementById('orderCustomerName').value,
    customer_phone: document.getElementById('orderCustomerPhone').value,
    customer_wilaya: document.getElementById('orderWilaya').value,
    customer_commune: document.getElementById('orderCommune').value,
    delivery_type: document.getElementById('orderDeliveryType').value,
    items: document.getElementById('orderItems').value,
    cod_amount: parseFloat(document.getElementById('orderCodAmount').value),
    shipping_fee: parseFloat(document.getElementById('orderShippingFee').value) || 0
  };

  try {
    const res = await fetch(`/api/orders`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ ...body, store_id: currentStore.id })
    });
    const order = await res.json();
    if (!res.ok) throw new Error(order.error || 'Failed to create order');
    const orderNumber = order.order_number;
    addZimamLog(orderNumber, 'ORDER_CREATED', `Order ${orderNumber} created for ${body.customer_name}`);
    const confirmLink = `${window.location.origin}/zimam/${orderNumber}?action=confirm`;
    const cancelLink = `${window.location.origin}/zimam/${orderNumber}?action=cancel`;
    const message = `Bonjour ${body.customer_name}, votre commande ${orderNumber} chez ${currentStore?.name || 'StorePulse'} a été reçue.

` +
      `Veuillez vérifier vos coordonnées:
` +
      `- Nom: ${body.customer_name}
` +
      `- Téléphone: ${body.customer_phone}
` +
      `- Wilaya: ${body.customer_wilaya}
` +
      `- Commune: ${body.customer_commune}
` +
      `- Mode de livraison: ${body.delivery_type}
` +
      `- Montant: ${body.cod_amount} DZD
` +
      `- Articles: ${body.items}

` +
      `Choisissez une action:
` +
      `✅ Confirmer: ${confirmLink}
` +
      `❌ Annuler: ${cancelLink}`;
    await fetch(`${API_BASE}/whatsapp/send`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ to: body.customer_phone, message })
    });
    addZimamLog(orderNumber, 'WHATSAPP_SENT', `Confirmation template sent to ${body.customer_phone}`);
    closeModal();
    loadOrders();
    alert(`Order ${orderNumber} created. WhatsApp confirmation sent. Track in Zimam Log.`);
  } catch (err) {
    alert('Failed to create order: ' + err.message);
  }
}

// ============ PRODUCTS: EDIT / DELETE ============}

// ============ PRODUCTS: EDIT / DELETE ============

async function editProduct(id) {
  try {
    const res = await fetch(`/api/products/${id}`, { headers: getHeaders() });
    const data = await res.json();
    const product = data;
    if (!product) return alert('Product not found');
    const content = `
      <form onsubmit="updateProduct(event, ${id})" class="form-grid">
        <div class="form-group">
          <label>Product Name *</label>
          <input type="text" id="editProductName" value="${escapeHtml(product.name)}" required>
        </div>
        <div class="form-group">
          <label>SKU</label>
          <input type="text" id="editProductSku" value="${escapeHtml(product.sku || '')}">
        </div>
        <div class="form-group">
          <label>Price (DZD) *</label>
          <input type="number" id="editProductPrice" value="${product.price}" required>
        </div>
        <div class="form-group">
          <label>Stock</label>
          <input type="number" id="editProductStock" value="${product.stock}">
        </div>
        <div class="form-group">
          <label>Category</label>
          <input type="text" id="editProductCategory" value="${escapeHtml(product.category || '')}">
        </div>
        <div style="display:flex;gap:0.75rem;">
          <button type="submit" class="btn btn-primary" style="flex:1;">Update Product</button>
          <button type="button" class="btn btn-danger" onclick="deleteProduct(${id})" style="flex:1;">Delete</button>
        </div>
      </form>
    `;
    showModal('Edit Product', content);
  } catch (err) {
    alert('Failed to load product: ' + err.message);
  }
}

async function updateProduct(e, id) {
  e.preventDefault();
  try {
    await fetch(`/api/products/${id}`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({
      name: document.getElementById('editProductName').value,
      sku: document.getElementById('editProductSku').value,
      price: parseFloat(document.getElementById('editProductPrice').value),
      stock: parseInt(document.getElementById('editProductStock').value) || 0,
      category: document.getElementById('editProductCategory').value
    })
    });
    closeModal();
    loadProducts();
  } catch (err) {
    alert('Failed to update: ' + err.message);
  }
}

async function deleteProduct(id) {
  if (!confirm('Delete this product?')) return;
  try {
    await fetch(`/api/products/${id}`, { method: 'DELETE', headers: getHeaders() });
    closeModal();
    loadProducts();
  } catch (err) {
    alert('Failed to delete: ' + err.message);
  }
}

// ============ ORDERS: WhatsApp QUICK ACTIONS ============

async function whatsAppOrder(orderId) {
  try {
    const res = await fetch(`/api/orders/${orderId}`, { headers: getHeaders() });
    const data = await res.json();
    const order = data;
    if (!order) return alert('Order not found');
    const message = `Bonjour ${order.customer_name}, votre commande ${order.order_number} (${formatCurrency(order.cod_amount)}). Statut actuel: ${order.status}. Articles: ${order.items}.`;
    const link = `https://wa.me/${order.customer_phone.replace(/\s/g, '')}?text=${encodeURIComponent(message)}`;
    window.open(link, '_blank');
  } catch (err) {
    alert('Failed: ' + err.message);
  }
}

async function whatsAppTracking(orderId) {
  try {
    const res = await fetch(`/api/orders/${orderId}`, { headers: getHeaders() });
    const data = await res.json();
    const order = data;
    if (!order) return alert('Order not found');
    if (!order.tracking_number) return alert('No tracking number yet');
    const message = `Bonjour ${order.customer_name}, suivez votre commande ${order.order_number} avec ${order.delivery_company || 'notre livreur'}. Numéro: ${order.tracking_number}.`;
    const link = `https://wa.me/${order.customer_phone.replace(/\s/g, '')}?text=${encodeURIComponent(message)}`;
    window.open(link, '_blank');
  } catch (err) {
    alert('Failed: ' + err.message);
  }
}

// ============ ZIMAM AUTOMATION ============

let zimamLog = [];
let zimamOrders = {};

function addZimamLog(orderId, event, detail) {
  zimamLog.unshift({
    time: new Date().toLocaleString('fr-FR'),
    orderId,
    event,
    detail
  });
}

function showZimamLog() {
  const content = document.getElementById('zimamLogContent');
  if (!zimamLog.length) {
    content.innerHTML = '<p style="color:var(--text-muted);">No automation events yet. Create an order to start.</p>';
  } else {
    content.innerHTML = zimamLog.map(entry => `
      <div style="padding:0.75rem 0;border-bottom:1px solid var(--border);">
        <div style="display:flex;justify-content:space-between;font-size:0.875rem;">
          <strong>${entry.orderId}</strong>
          <span style="color:var(--text-muted);font-size:0.8125rem;">${entry.time}</span>
        </div>
        <div style="font-size:0.875rem;margin-top:0.25rem;"><strong>${entry.event}:</strong> ${entry.detail}</div>
      </div>
    `).join('');
  }
  document.getElementById('zimamLogModal').classList.remove('hidden');
}

async function simulateZimamWebhook() {
  const pending = Object.entries(zimamOrders).filter(([id, o]) => o.status === 'Pending Call');
  if (!pending.length) {
    alert('No pending orders to simulate webhook for.');
    return;
  }
  const [id, order] = pending[0];
  const actions = [
    { action: 'confirm', method: 'cod', label: 'Confirm (COD)' },
    { action: 'confirm', method: 'ccp', label: 'Confirm (CCP)' },
    { action: 'cancel', method: null, label: 'Cancel' }
  ];
  const choice = actions[Math.floor(Math.random() * actions.length)];
  if (choice.action === 'confirm') {
    order.status = 'Confirmed by Phone';
    order.payment = choice.method;
    addZimamLog(id, 'WEBHOOK_SIMULATED', `Simulated confirmation via ${choice.method.toUpperCase()}`);
  } else {
    order.status = 'Cancelled';
    addZimamLog(id, 'WEBHOOK_SIMULATED', 'Simulated cancellation');
  }
  alert(`Simulated webhook for ${id}: ${choice.label}`);
}

// ============ MODAL ============
