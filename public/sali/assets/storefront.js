// Boutique SALI Storefront — connected to StorePulse or fallback to local data
// Uses current origin so it works both locally and through tunnels/domains
const STOREFRONT_API = "https://storepulse-gi6e.onrender.com/api/storefront/sali";
const STOREFRONT_KEY = 'sp_c2FsaTE3OTM3ODU1NzY3NzE';

// Fallback product data for offline use
const FALLBACK_PRODUCTS = [
  { id: 1, name: 'Silk Blend Blouse', sku: 'SALI-TOP-001', price: 4200, stock: 25, low_stock_threshold: 5, category: 'Tops', image_url: null },
  { id: 2, name: 'Evening Elegance Dress', sku: 'SALI-DR-001', price: 12500, stock: 15, low_stock_threshold: 5, category: 'Dresses', image_url: null },
  { id: 3, name: 'Cashmere Wrap Coat', sku: 'SALI-OUT-001', price: 18900, stock: 8, low_stock_threshold: 5, category: 'Outerwear', image_url: null },
  { id: 4, name: 'Classic Leather Tote', sku: 'SALI-ACC-001', price: 9600, stock: 20, low_stock_threshold: 5, category: 'Accessories', image_url: null },
  { id: 5, name: 'Pleated Midi Skirt', sku: 'SALI-BOT-001', price: 3500, stock: 30, low_stock_threshold: 5, category: 'Bottoms', image_url: null },
  { id: 6, name: 'Premium Leather Heels', sku: 'SALI-SHOE-001', price: 8900, stock: 12, low_stock_threshold: 5, category: 'Shoes', image_url: null }
];

// ============ INIT ============
document.addEventListener('DOMContentLoaded', () => {
  // Track page view
  trackVisitor();
  
  // Load products on shop page
  if (document.getElementById('productsGrid')) {
    loadProducts();
  }
  
  // Load product detail on product page
  if (document.getElementById('productDetail')) {
    const id = new URLSearchParams(window.location.search).get('id');
    if (id) loadProductDetail(id);
  }
  
  // Setup contact form
  const contactForm = document.getElementById('contactForm');
  if (contactForm) {
    contactForm.addEventListener('submit', handleContactForm);
  }
  
  // Setup order form on product page
  const orderForm = document.getElementById('orderForm');
  if (orderForm) {
    orderForm.addEventListener('submit', handleOrderForm);
  }
});

// ============ PRODUCTS ============
async function loadProducts() {
  const grid = document.getElementById('productsGrid');
  if (!grid) return;
  
  try {
    const res = await fetch(`${STOREFRONT_API}/products`, {
      headers: { 'X-API-Key': STOREFRONT_KEY }
    });
    const data = await res.json();
    renderProducts(data.products || []);
  } catch (err) {
    console.error('Failed to load products:', err);
    grid.innerHTML = '<p class="empty-state">Failed to load products. Please try again later.</p>';
    
    // Fallback to local data
    if (document.getElementById('productsGrid')) {
      renderProducts(FALLBACK_PRODUCTS);
    }
  }
}

function renderProducts(products) {
  const grid = document.getElementById('productsGrid');
  if (!products.length) {
    grid.innerHTML = '<p class="empty-state">No products available yet.</p>';
    return;
  }
  
  grid.innerHTML = products.map(p => `
    <div class="product-card" data-category="${p.category || ''}" data-price="${p.price}" data-popularity="50">
      <div class="product-image">
        ${escapeHtml(p.name)}
      </div>
      <div class="product-info">
        <div class="product-category">${escapeHtml(p.category || 'General')}</div>
        <div class="product-name">${escapeHtml(p.name)}</div>
        <div class="product-price">${formatCurrency(p.price)}</div>
        <div class="product-actions">
          <button class="btn-small btn-add" onclick="addToCart(${p.id})">Add to Cart</button>
          <button class="btn-small btn-view" onclick="viewProduct(${p.id})">View</button>
        </div>
      </div>
    </div>
  `).join('');
}

function viewProduct(id) {
  window.location.href = `product.html?id=${id}`;
}

async function loadProductDetail(id) {
  try {
    const res = await fetch(`${STOREFRONT_API}/products`, {
      headers: { 'X-API-Key': STOREFRONT_KEY }
    });
    const data = await res.json();
    const product = data.products.find(p => p.id == id);
    
    if (!product) {
      document.getElementById('productDetail').innerHTML = '<p class="empty-state">Product not found</p>';
      return;
    }
    
    currentProduct = product;
    document.querySelector('.product-hero-title').textContent = product.name;
    document.querySelector('.product-hero-price').textContent = formatCurrency(product.price);
    document.querySelector('.product-hero-category').textContent = product.category || 'General';
    document.querySelector('.product-hero-description').textContent = product.name + ' — premium quality from Boutique SALI.';
    document.getElementById('orderItems').value = product.name;
    document.getElementById('orderAmount').value = product.price;
  } catch (err) {
    console.error('Failed to load product:', err);
  }
}

// ============ CART / ORDER ============
function addToCart(productId) {
  // For simplicity, add to cart by opening product detail
  viewProduct(productId);
}

async function handleOrderForm(e) {
  e.preventDefault();
  if (!currentProduct) return;
  
  const body = {
    customer_name: document.getElementById('orderName').value,
    customer_phone: document.getElementById('orderPhone').value,
    customer_wilaya: document.getElementById('orderWilaya').value,
    customer_commune: document.getElementById('orderCommune').value,
    delivery_type: document.getElementById('orderDelivery').value,
    items: document.getElementById('orderItems').value,
    cod_amount: parseFloat(document.getElementById('orderAmount').value),
    shipping_fee: 0
  };
  
  try {
    const res = await fetch(`${STOREFRONT_API}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': STOREFRONT_KEY },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    alert(`Order ${data.order_number} created successfully! We will contact you shortly.`);
    document.getElementById('orderForm').reset();
  } catch (err) {
    alert('Order failed: ' + err.message);
  }
}

// ============ CONTACT FORM ============
async function handleContactForm(e) {
  e.preventDefault();
  const name = document.getElementById('contactName').value;
  const phone = document.getElementById('contactPhone').value;
  const message = document.getElementById('contactMessage').value;
  
  // Create a lead order in StorePulse
  try {
    await fetch(`${STOREFRONT_API}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': STOREFRONT_KEY },
      body: JSON.stringify({
        customer_name: name,
        customer_phone: phone,
        items: 'Contact Form Inquiry',
        cod_amount: 0,
        shipping_fee: 0,
        notes: message
      })
    });
    alert('Message sent! We will contact you soon.');
    document.getElementById('contactForm').reset();
  } catch (err) {
    alert('Failed to send: ' + err.message);
  }
}

// ============ VISITOR TRACKING ============
function trackVisitor() {
  const page = window.location.pathname;
  const device = /Mobile|Android|iPhone/i.test(navigator.userAgent) ? 'Mobile' : 'Desktop';
  fetch(`${STOREFRONT_API}/visitors/track`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ page, device, cart_status: 'Browsing' })
  }).catch(() => {});
}

// ============ UTILITIES ============
function formatCurrency(amount) {
  return parseFloat(amount).toLocaleString('en-US') + ' DZD';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}