const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'storepulse-secret-change-in-production-2026';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'storepulse.db');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Database
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS stores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    api_key TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    settings TEXT DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    sku TEXT,
    price REAL NOT NULL,
    stock INTEGER DEFAULT 0,
    low_stock_threshold INTEGER DEFAULT 5,
    category TEXT,
    image_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS product_variants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    size TEXT,
    color TEXT,
    stock INTEGER DEFAULT 0,
    sku TEXT,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    wilaya TEXT,
    commune TEXT,
    total_orders INTEGER DEFAULT 0,
    total_spend REAL DEFAULT 0,
    first_order_at DATETIME,
    last_order_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL,
    customer_id INTEGER,
    order_number TEXT UNIQUE NOT NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_wilaya TEXT,
    customer_commune TEXT,
    delivery_type TEXT DEFAULT 'Home Delivery',
    items TEXT NOT NULL,
    subtotal REAL NOT NULL,
    shipping_fee REAL DEFAULT 0,
    cod_amount REAL NOT NULL,
    status TEXT DEFAULT 'Pending Call',
    payment_method TEXT,
    tracking_number TEXT,
    delivery_company TEXT,
    notes TEXT,
    confirmed_at DATETIME,
    shipped_at DATETIME,
    delivered_at DATETIME,
    returned_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS shipments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL,
    order_id INTEGER NOT NULL,
    tracking_number TEXT,
    delivery_company TEXT NOT NULL,
    status TEXT DEFAULT 'Prepared',
    shipping_fee REAL DEFAULT 0,
    cod_amount REAL DEFAULT 0,
    label_url TEXT,
    shipped_at DATETIME,
    delivered_at DATETIME,
    returned_at DATETIME,
    return_reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS delivery_companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    api_key TEXT,
    api_url TEXT,
    active INTEGER DEFAULT 1,
    settings TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
    UNIQUE(store_id, slug)
  );

  CREATE TABLE IF NOT EXISTS delivery_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL,
    company_id INTEGER NOT NULL,
    wilaya TEXT NOT NULL,
    commune TEXT,
    home_delivery_fee REAL DEFAULT 0,
    stop_desk_fee REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
    FOREIGN KEY (company_id) REFERENCES delivery_companies(id) ON DELETE CASCADE,
    UNIQUE(store_id, company_id, wilaya, commune)
  );

  CREATE TABLE IF NOT EXISTS visitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL,
    session_id TEXT,
    page TEXT,
    country TEXT,
    device TEXT,
    cart_status TEXT DEFAULT 'Browsing',
    landed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_orders_store ON orders(store_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_customers_store ON customers(store_id);
  CREATE INDEX IF NOT EXISTS idx_shipments_store ON shipments(store_id);
  CREATE INDEX IF NOT EXISTS idx_delivery_companies_store ON delivery_companies(store_id);
  CREATE INDEX IF NOT EXISTS idx_visitors_store ON visitors(store_id, landed_at);
`);

// Migration: add subtotal column if missing
const subtotalCol = db.prepare("PRAGMA table_info(orders)").all().find(c => c.name === 'subtotal');
if (!subtotalCol) {
  db.prepare('ALTER TABLE orders ADD COLUMN subtotal REAL DEFAULT 0');
}

// Migration: add whatsapp_number column if missing
try {
  db.prepare('ALTER TABLE stores ADD COLUMN whatsapp_number TEXT');
} catch (e) {
  // column already exists
}

// Auth middleware
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.storeId = decoded.storeId;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ============ AUTH ROUTES ============

// Login
app.post('/api/auth/login', (req, res) => {
  const { slug, password } = req.body;
  if (!slug || !password) {
    return res.status(400).json({ error: 'Store slug and password required' });
  }

  const store = db.prepare('SELECT * FROM stores WHERE slug = ?').get(slug);
  if (!store) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const valid = bcrypt.compareSync(password, store.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { storeId: store.id, slug: store.slug },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  // Clean old sessions
  db.prepare('DELETE FROM sessions WHERE store_id = ?').run(store.id);
  db.prepare(`INSERT INTO sessions (store_id, token, expires_at) VALUES (?, ?, datetime('now', '+7 days'))`).run(store.id, token);

  res.json({
    token,
    store: {
      id: store.id,
      name: store.name,
      slug: store.slug
    }
  });
});

// Register new store
app.post('/api/auth/register', (req, res) => {
  const { name, slug, password } = req.body;
  if (!name || !slug || !password) {
    return res.status(400).json({ error: 'Name, slug, and password required' });
  }

  const existing = db.prepare('SELECT id FROM stores WHERE slug = ?').get(slug);
  if (existing) {
    return res.status(409).json({ error: 'Store slug already exists' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const apiKey = 'sp_' + Buffer.from(slug + Date.now()).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 24);

  const result = db.prepare('INSERT INTO stores (name, slug, password_hash, api_key) VALUES (?, ?, ?, ?)').run(name, slug, passwordHash, apiKey);

  const token = jwt.sign(
    { storeId: result.lastInsertRowid, slug },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  db.prepare(`INSERT INTO sessions (store_id, token, expires_at) VALUES (?, ?, datetime('now', '+7 days'))`).run(result.lastInsertRowid, token);

  res.status(201).json({
    token,
    store: {
      id: result.lastInsertRowid,
      name,
      slug
    }
  });
});

// Verify session
app.get('/api/auth/verify', authMiddleware, (req, res) => {
  const store = db.prepare('SELECT id, name, slug FROM stores WHERE id = ?').get(req.storeId);
  if (!store) {
    return res.status(404).json({ error: 'Store not found' });
  }
  res.json({ store });
});

// ============ DASHBOARD ROUTES ============

// Overview stats
app.get('/api/dashboard/overview', authMiddleware, (req, res) => {
  const storeId = req.storeId;
  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const todaySales = db.prepare(`SELECT COALESCE(SUM(cod_amount), 0) as total FROM orders WHERE store_id = ? AND date(created_at) = ? AND status != 'Cancelled'`).get(storeId, today);
  const weekSales = db.prepare(`SELECT COALESCE(SUM(cod_amount), 0) as total FROM orders WHERE store_id = ? AND date(created_at) >= ? AND status != 'Cancelled'`).get(storeId, weekAgo);
  const todayOrders = db.prepare('SELECT COUNT(*) as count FROM orders WHERE store_id = ? AND date(created_at) = ?').get(storeId, today);
  const weekOrders = db.prepare('SELECT COUNT(*) as count FROM orders WHERE store_id = ? AND date(created_at) >= ?').get(storeId, weekAgo);
  const pendingOrders = db.prepare(`SELECT COUNT(*) as count FROM orders WHERE store_id = ? AND status = 'Pending Call'`).get(storeId);
  const confirmedOrders = db.prepare(`SELECT COUNT(*) as count FROM orders WHERE store_id = ? AND status = 'Confirmed by Phone'`).get(storeId);
  const outForDelivery = db.prepare(`SELECT COUNT(*) as count FROM orders WHERE store_id = ? AND status = 'Out for Delivery'`).get(storeId);
  const deliveredOrders = db.prepare(`SELECT COUNT(*) as count FROM orders WHERE store_id = ? AND status = 'Delivered'`).get(storeId);
  const totalCustomers = db.prepare('SELECT COUNT(*) as count FROM customers WHERE store_id = ?').get(storeId);
  const avgOrderValue = db.prepare(`SELECT COALESCE(AVG(cod_amount), 0) as avg FROM orders WHERE store_id = ? AND status != 'Cancelled'`).get(storeId);

  // Sales chart data (last 7 days)
  const salesChart = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const daySales = db.prepare(`SELECT COALESCE(SUM(cod_amount), 0) as total FROM orders WHERE store_id = ? AND date(created_at) = ? AND status != 'Cancelled'`).get(storeId, d);
    const dayOrders = db.prepare('SELECT COUNT(*) as count FROM orders WHERE store_id = ? AND date(created_at) = ?').get(storeId, d);
    salesChart.push({
      date: d,
      sales: daySales.total,
      orders: dayOrders.count
    });
  }

  // Live visitors
  const liveVisitors = db.prepare(`SELECT COUNT(*) as count FROM visitors WHERE store_id = ? AND datetime(landed_at) > datetime('now', '-30 minutes')`).get(storeId);

  // Conversion funnel
  const visitors = db.prepare('SELECT COUNT(*) as count FROM visitors WHERE store_id = ?').get(storeId).count;
  const productViews = db.prepare(`SELECT COUNT(*) as count FROM visitors WHERE store_id = ? AND page LIKE '%product%'`).get(storeId).count;
  const addToCart = db.prepare(`SELECT COUNT(*) as count FROM visitors WHERE store_id = ? AND cart_status = 'Added to Cart'`).get(storeId).count;
  const checkouts = db.prepare('SELECT COUNT(*) as count FROM orders WHERE store_id = ?').get(storeId).count;

  res.json({
    stats: {
      todaySales: todaySales.total,
      weekSales: weekSales.total,
      todayOrders: todayOrders.count,
      weekOrders: weekOrders.count,
      pendingOrders: pendingOrders.count,
      confirmedOrders: confirmedOrders.count,
      outForDelivery: outForDelivery.count,
      deliveredOrders: deliveredOrders.count,
      totalCustomers: totalCustomers.count,
      avgOrderValue: avgOrderValue.avg,
      liveVisitors: liveVisitors.count
    },
    salesChart,
    funnel: {
      visitors,
      productViews,
      addToCart,
      checkouts
    }
  });
});

// Orders list
app.get('/api/orders', authMiddleware, (req, res) => {
  const storeId = req.storeId;
  const { status, search, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let query = 'SELECT * FROM orders WHERE store_id = ?';
  const params = [storeId];

  if (status && status !== 'all') {
    query += ' AND status = ?';
    params.push(status);
  }

  if (search) {
    query += ' AND (customer_name LIKE ? OR customer_phone LIKE ? OR order_number LIKE ? OR tracking_number LIKE ?)';
    const term = `%${search}%`;
    params.push(term, term, term, term);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), offset);

  const orders = db.prepare(query).all(...params);
  const total = db.prepare('SELECT COUNT(*) as count FROM orders WHERE store_id = ?' + (status && status !== 'all' ? ' AND status = ?' : '')).all(...params.filter((_, i) => i < (status && status !== 'all' ? 2 : 1))).count;

  res.json({ orders, total, page: parseInt(page), limit: parseInt(limit) });
});

// Update order
app.patch('/api/orders/:id', authMiddleware, (req, res) => {
  const storeId = req.storeId;
  const orderId = req.params.id;
  const updates = req.body;

  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND store_id = ?').get(orderId, storeId);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  const allowedFields = ['status', 'payment_method', 'tracking_number', 'delivery_company', 'notes'];
  const setClause = [];
  const values = [];

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      setClause.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (setClause.length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  // Auto-set timestamps for status changes
  if (updates.status === 'Confirmed by Phone' && !order.confirmed_at) {
    setClause.push(`confirmed_at = datetime('now')`);
  }
  if (updates.status === 'Out for Delivery' && !order.shipped_at) {
    setClause.push(`shipped_at = datetime('now')`);
  }
  if (updates.status === 'Delivered' && !order.delivered_at) {
    setClause.push(`delivered_at = datetime('now')`);
  }
  if (updates.status === 'Returned' && !order.returned_at) {
    setClause.push(`returned_at = datetime('now')`);
  }

  values.push(orderId, storeId);
  db.prepare(`UPDATE orders SET ${setClause.join(', ')} WHERE id = ? AND store_id = ?`).run(...values);

  // If status changed to Delivered, update customer stats
  if (updates.status === 'Delivered' && order.status !== 'Delivered') {
    if (order.customer_id) {
      db.prepare(`
        UPDATE customers SET
          total_orders = total_orders + 1,
          total_spend = total_spend + ?,
          last_order_at = datetime('now')
        WHERE id = ?
      `).run(order.cod_amount, order.customer_id);
    }
  }

  const updated = db.prepare('SELECT * FROM orders WHERE id = ? AND store_id = ?').get(orderId, storeId);
  res.json(updated);
});

// Create order
app.post('/api/orders', authMiddleware, (req, res) => {
  const storeId = req.storeId;
  const { customer_name, customer_phone, customer_wilaya, customer_commune, delivery_type, items, cod_amount, shipping_fee = 0, notes } = req.body;

  if (!customer_name || !customer_phone || !items || !cod_amount) {
    return res.status(400).json({ error: 'Customer name, phone, items, and COD amount required' });
  }

  const orderNumber = 'BS-' + Date.now().toString().slice(-6);

  // Find or create customer
  let customer = db.prepare('SELECT * FROM customers WHERE store_id = ? AND phone = ?').get(storeId, customer_phone);
  if (!customer) {
    const result = db.prepare('INSERT INTO customers (store_id, name, phone, wilaya, commune) VALUES (?, ?, ?, ?, ?)').run(storeId, customer_name, customer_phone, customer_wilaya, customer_commune);
    customer = { id: result.lastInsertRowid };
  }

  const subtotal = parseFloat(cod_amount) - parseFloat(shipping_fee || 0);

  const result = db.prepare(`
    INSERT INTO orders (store_id, customer_id, order_number, customer_name, customer_phone, customer_wilaya, customer_commune, delivery_type, items, subtotal, cod_amount, shipping_fee, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(storeId, customer.id, orderNumber, customer_name, customer_phone, customer_wilaya, customer_commune, delivery_type, items, subtotal, cod_amount, shipping_fee, notes || null);

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(order);
});

// Customers list
app.get('/api/customers', authMiddleware, (req, res) => {
  const storeId = req.storeId;
  const { search } = req.query;
  let query = 'SELECT * FROM customers WHERE store_id = ?';
  const params = [storeId];

  if (search) {
    query += ' AND (name LIKE ? OR phone LIKE ? OR email LIKE ?)';
    const term = `%${search}%`;
    params.push(term, term, term);
  }

  query += ' ORDER BY total_spend DESC';
  const customers = db.prepare(query).all(...params);
  res.json({ customers });
});

// ============ DELIVERY ROUTES ============

// Delivery companies
app.get('/api/delivery/companies', authMiddleware, (req, res) => {
  const storeId = req.storeId;
  const companies = db.prepare('SELECT * FROM delivery_companies WHERE store_id = ? ORDER BY name').all(storeId);
  res.json({ companies });
});

app.post('/api/delivery/companies', authMiddleware, (req, res) => {
  const storeId = req.storeId;
  const { name, slug, api_key, api_url } = req.body;

  if (!name || !slug) {
    return res.status(400).json({ error: 'Name and slug required' });
  }

  try {
    const result = db.prepare('INSERT INTO delivery_companies (store_id, name, slug, api_key, api_url) VALUES (?, ?, ?, ?, ?)').run(storeId, name, slug, api_key || null, api_url || null);
    const company = db.prepare('SELECT * FROM delivery_companies WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(company);
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Company with this slug already exists for this store' });
    }
    throw err;
  }
});

app.patch('/api/delivery/companies/:id', authMiddleware, (req, res) => {
  const storeId = req.storeId;
  const companyId = req.params.id;
  const { name, api_key, api_url, active } = req.body;

  const company = db.prepare('SELECT * FROM delivery_companies WHERE id = ? AND store_id = ?').get(companyId, storeId);
  if (!company) {
    return res.status(404).json({ error: 'Company not found' });
  }

  db.prepare('UPDATE delivery_companies SET name = COALESCE(?, name), api_key = COALESCE(?, api_key), api_url = COALESCE(?, api_url), active = COALESCE(?, active) WHERE id = ?').run(name || null, api_key || null, api_url || null, active !== undefined ? (active ? 1 : 0) : null, companyId);
  const updated = db.prepare('SELECT * FROM delivery_companies WHERE id = ?').get(companyId);
  res.json(updated);
});

app.delete('/api/delivery/companies/:id', authMiddleware, (req, res) => {
  const storeId = req.storeId;
  const companyId = req.params.id;
  db.prepare('DELETE FROM delivery_companies WHERE id = ? AND store_id = ?').run(companyId, storeId);
  res.status(204).send();
});

// Shipments
app.get('/api/delivery/shipments', authMiddleware, (req, res) => {
  const storeId = req.storeId;
  const { status, company, search, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let query = 'SELECT s.*, o.order_number, o.customer_name, o.customer_phone FROM shipments s JOIN orders o ON s.order_id = o.id WHERE s.store_id = ?';
  const params = [storeId];

  if (status && status !== 'all') {
    query += ' AND s.status = ?';
    params.push(status);
  }
  if (company) {
    query += ' AND s.delivery_company = ?';
    params.push(company);
  }
  if (search) {
    query += ' AND (o.order_number LIKE ? OR o.customer_name LIKE ? OR s.tracking_number LIKE ?)';
    const term = `%${search}%`;
    params.push(term, term, term);
  }

  query += ' ORDER BY s.created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), offset);

  const shipments = db.prepare(query).all(...params);
  res.json({ shipments });
});

app.post('/api/delivery/shipments', authMiddleware, (req, res) => {
  const storeId = req.storeId;
  const { order_id, delivery_company, shipping_fee = 0, cod_amount = 0 } = req.body;

  if (!order_id || !delivery_company) {
    return res.status(400).json({ error: 'Order ID and delivery company required' });
  }

  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND store_id = ?').get(order_id, storeId);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  const trackingNumber = delivery_company.toUpperCase().substring(0, 3) + '-' + Date.now().toString().slice(-8);

  const result = db.prepare(`
    INSERT INTO shipments (store_id, order_id, tracking_number, delivery_company, status, shipping_fee, cod_amount)
    VALUES (?, ?, ?, ?, 'Prepared', ?, ?)
  `).run(storeId, order_id, trackingNumber, delivery_company, shipping_fee, cod_amount);

  // Update order with tracking info
  db.prepare(`UPDATE orders SET tracking_number = ?, delivery_company = ?, status = 'Sent to Delivery' WHERE id = ?`).run(trackingNumber, delivery_company, order_id);

  const shipment = db.prepare('SELECT * FROM shipments WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(shipment);
});

app.patch('/api/delivery/shipments/:id', authMiddleware, (req, res) => {
  const storeId = req.storeId;
  const shipmentId = req.params.id;
  const updates = req.body;

  const shipment = db.prepare('SELECT * FROM shipments WHERE id = ? AND store_id = ?').get(shipmentId, storeId);
  if (!shipment) {
    return res.status(404).json({ error: 'Shipment not found' });
  }

  const allowedFields = ['status', 'tracking_number', 'label_url', 'return_reason'];
  const setClause = [];
  const values = [];

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      setClause.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (updates.status === 'Delivered') setClause.push(`delivered_at = datetime('now')`);
  if (updates.status === 'Returned') setClause.push(`returned_at = datetime('now')`);

  values.push(shipmentId, storeId);
  db.prepare(`UPDATE shipments SET ${setClause.join(', ')}, updated_at = datetime('now') WHERE id = ? AND store_id = ?`).run(...values);

  // Sync status to order
  if (updates.status) {
    const orderStatusMap = {
      'Prepared': 'Sent to Delivery',
      'Picked up by Courier': 'Out for Delivery',
      'Out for delivery': 'Out for Delivery',
      'Delivered': 'Delivered',
      'Returned': 'Returned'
    };
    const orderStatus = orderStatusMap[updates.status];
    if (orderStatus) {
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(orderStatus, shipment.order_id);
    }
  }

  const updated = db.prepare('SELECT * FROM shipments WHERE id = ?').get(shipmentId);
  res.json(updated);
});

// Delivery rates
app.get('/api/delivery/rates', authMiddleware, (req, res) => {
  const storeId = req.storeId;
  const { company_id } = req.query;
  let query = 'SELECT * FROM delivery_rates WHERE store_id = ?';
  const params = [storeId];

  if (company_id) {
    query += ' AND company_id = ?';
    params.push(company_id);
  }

  const rates = db.prepare(query).all(...params);
  res.json({ rates });
});

app.post('/api/delivery/rates', authMiddleware, (req, res) => {
  const storeId = req.storeId;
  const { company_id, wilaya, commune, home_delivery_fee = 0, stop_desk_fee = 0 } = req.body;

  if (!company_id || !wilaya) {
    return res.status(400).json({ error: 'Company ID and wilaya required' });
  }

  try {
    const result = db.prepare(`
      INSERT OR REPLACE INTO delivery_rates (store_id, company_id, wilaya, commune, home_delivery_fee, stop_desk_fee)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(storeId, company_id, wilaya, commune || null, home_delivery_fee, stop_desk_fee);
    const rate = db.prepare('SELECT * FROM delivery_rates WHERE id = ?').get(result.lastInsertRowid);
    res.json(rate);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ PRODUCTS ============

app.get('/api/products', authMiddleware, (req, res) => {
  const storeId = req.storeId;
  const products = db.prepare('SELECT * FROM products WHERE store_id = ? ORDER BY created_at DESC').all(storeId);
  res.json({ products });
});

app.post('/api/products', authMiddleware, (req, res) => {
  const storeId = req.storeId;
  const { name, sku, price, stock = 0, category, image_url } = req.body;

  if (!name || !price) {
    return res.status(400).json({ error: 'Name and price required' });
  }

  const result = db.prepare('INSERT INTO products (store_id, name, sku, price, stock, category, image_url) VALUES (?, ?, ?, ?, ?, ?, ?)').run(storeId, name, sku || null, price, stock, category || null, image_url || null);
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(product);
});

app.patch('/api/products/:id', authMiddleware, (req, res) => {
  const storeId = req.storeId;
  const productId = req.params.id;
  const { name, sku, price, stock, category, image_url } = req.body;

  const product = db.prepare('SELECT * FROM products WHERE id = ? AND store_id = ?').get(productId, storeId);
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }

  db.prepare('UPDATE products SET name = COALESCE(?, name), sku = COALESCE(?, sku), price = COALESCE(?, price), stock = COALESCE(?, stock), category = COALESCE(?, category), image_url = COALESCE(?, image_url) WHERE id = ?').run(name || null, sku || null, price || null, stock !== undefined ? stock : null, category || null, image_url || null, productId);
  const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  res.json(updated);
});

// Product variants
app.post('/api/products/:id/variants', authMiddleware, (req, res) => {
  const storeId = req.storeId;
  const productId = req.params.id;
  const { size, color, stock = 0, sku } = req.body;

  const product = db.prepare('SELECT id FROM products WHERE id = ? AND store_id = ?').get(productId, storeId);
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }

  const result = db.prepare('INSERT INTO product_variants (product_id, size, color, stock, sku) VALUES (?, ?, ?, ?, ?)').run(productId, size || null, color || null, stock, sku || null);
  const variant = db.prepare('SELECT * FROM product_variants WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(variant);
});

// ============ VISITORS TRACKING ============

app.post('/api/visitors/track', (req, res) => {
  const { store_slug, page, country, device, cart_status } = req.body;
  if (!store_slug) {
    return res.status(400).json({ error: 'Store slug required' });
  }

  const store = db.prepare('SELECT id FROM stores WHERE slug = ?').get(store_slug);
  if (!store) {
    return res.status(404).json({ error: 'Store not found' });
  }

  const sessionId = req.body.session_id || 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  db.prepare('INSERT INTO visitors (store_id, session_id, page, country, device, cart_status) VALUES (?, ?, ?, ?, ?, ?)').run(store.id, sessionId, page || '/', country || 'Unknown', device || 'Unknown', cart_status || 'Browsing');
  res.status(201).json({ success: true });
});

app.get('/api/visitors/live', authMiddleware, (req, res) => {
  const storeId = req.storeId;
  const visitors = db.prepare(`
    SELECT * FROM visitors
    WHERE store_id = ? AND datetime(landed_at) > datetime('now', '-30 minutes')
    ORDER BY landed_at DESC
  `).all(storeId);
  res.json({ visitors });
});

// ============ TRACKING PAGE (PUBLIC) ============

app.get('/api/tracking/:trackingNumber', (req, res) => {
  const trackingNumber = req.params.trackingNumber;
  const shipment = db.prepare(`
    SELECT s.*, o.order_number, o.customer_name
    FROM shipments s
    JOIN orders o ON s.order_id = o.id
    WHERE s.tracking_number = ?
    ORDER BY s.created_at DESC
    LIMIT 1
  `).get(trackingNumber);

  if (!shipment) {
    return res.status(404).json({ error: 'Tracking not found' });
  }

  res.json(shipment);
});

// ============ WHATSAPP ============

// Get/set store WhatsApp config
app.get('/api/settings/whatsapp', authMiddleware, (req, res) => {
  const storeId = req.storeId;
  const store = db.prepare('SELECT whatsapp_number FROM stores WHERE id = ?').get(storeId);
  res.json({ whatsapp_number: store?.whatsapp_number || '' });
});

app.patch('/api/settings/whatsapp', authMiddleware, (req, res) => {
  const storeId = req.storeId;
  const { whatsapp_number } = req.body;
  db.prepare('UPDATE stores SET whatsapp_number = ? WHERE id = ?').run(whatsapp_number || null, storeId);
  res.json({ success: true, whatsapp_number });
});

// Send WhatsApp message (opens wa.me link or sends via API if configured)
app.post('/api/whatsapp/send', authMiddleware, (req, res) => {
  const storeId = req.storeId;
  const { to, message } = req.body;
  if (!to || !message) {
    return res.status(400).json({ error: 'Phone number and message required' });
  }
  const store = db.prepare('SELECT whatsapp_number FROM stores WHERE id = ?').get(storeId);
  // Return a wa.me link for frontend to open, or integrate with WhatsApp Business API later
  const from = store?.whatsapp_number || '';
  res.json({
    success: true,
    wa_link: `https://wa.me/${to.replace(/\s/g, '')}?text=${encodeURIComponent(message)}`,
    from
  });
});

// ============ COURIER WEBHOOK ============

app.post('/api/webhooks/courier/:company', (req, res) => {
  const company = req.params.company;
  const { tracking_number, status, event, timestamp } = req.body;

  if (!tracking_number || !status) {
    return res.status(400).json({ error: 'tracking_number and status required' });
  }

  try {
    const shipment = db.prepare('SELECT * FROM shipments WHERE tracking_number = ?').get(tracking_number);
    if (!shipment) {
      return res.status(404).json({ error: 'Shipment not found' });
    }

    const updates = { status, updated_at: new Date().toISOString() };
    if (status === 'Delivered') updates.delivered_at = new Date().toISOString();
    if (status === 'Returned') updates.returned_at = new Date().toISOString();

    const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    db.prepare(`UPDATE shipments SET ${setClause} WHERE id = ?`).run(...Object.values(updates), shipment.id);

    // Mirror to orders table
    const orderUpdates = {};
    if (status === 'Out for delivery') orderUpdates.shipped_at = new Date().toISOString();
    if (status === 'Delivered') orderUpdates.delivered_at = new Date().toISOString();
    if (status === 'Returned') orderUpdates.returned_at = new Date().toISOString();

    if (Object.keys(orderUpdates).length) {
      const orderSet = Object.keys(orderUpdates).map(k => `${k} = ?`).join(', ');
      db.prepare(`UPDATE orders SET ${orderSet} WHERE id = ?`).run(...Object.values(orderUpdates), shipment.order_id);
    }

    res.json({ success: true, shipment_id: shipment.id, order_id: shipment.order_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ ANALYTICS: LTV / RFM ============

app.get('/api/analytics/ltv', authMiddleware, (req, res) => {
  const storeId = req.storeId;
  const customers = db.prepare(`
    SELECT
      c.id,
      c.name,
      c.phone,
      c.wilaya,
      COUNT(o.id) as total_orders,
      COALESCE(SUM(o.cod_amount), 0) as total_spend,
      COALESCE(AVG(o.cod_amount), 0) as avg_order_value,
      MAX(o.created_at) as last_order_at,
      MIN(o.created_at) as first_order_at,
      CAST((julianday('now') - julianday(MAX(o.created_at))) AS INTEGER) as days_since_last_order
    FROM customers c
    LEFT JOIN orders o ON o.store_id = c.store_id AND o.customer_id = c.id AND o.status != 'Cancelled'
    WHERE c.store_id = ?
    GROUP BY c.id
    ORDER BY total_spend DESC
  `).all(storeId);

  const segments = customers.map(c => {
    let segment = 'New';
    if (c.total_orders >= 1 && c.days_since_last_order <= 30) segment = 'Active';
    else if (c.total_orders >= 1 && c.days_since_last_order <= 90) segment = 'Warm';
    else if (c.total_orders >= 1 && c.days_since_last_order > 90) segment = 'Cold';
    if (c.total_spend >= 50000) segment = 'VIP';
    return { ...c, segment };
  });

  res.json({ customers: segments });
});

app.get('/api/analytics/rfm', authMiddleware, (req, res) => {
  const storeId = req.storeId;
  const rows = db.prepare(`
    SELECT
      c.id,
      c.name,
      c.phone,
      COUNT(o.id) as frequency,
      COALESCE(SUM(o.cod_amount), 0) as monetary,
      CAST((julianday('now') - julianday(MAX(o.created_at))) AS INTEGER) as recency
    FROM customers c
    LEFT JOIN orders o ON o.store_id = c.store_id AND o.customer_id = c.id AND o.status != 'Cancelled'
    WHERE c.store_id = ?
    GROUP BY c.id
  `).all(storeId);

  // Simple RFM scoring 1-5
  const maxFreq = Math.max(...rows.map(r => r.frequency), 1);
  const maxMon = Math.max(...rows.map(r => r.monetary), 1);

  const scored = rows.map(r => {
    const rScore = r.recency <= 7 ? 5 : r.recency <= 30 ? 4 : r.recency <= 90 ? 3 : r.recency <= 180 ? 2 : 1;
    const fScore = Math.max(1, Math.round((r.frequency / maxFreq) * 5));
    const mScore = Math.max(1, Math.round((r.monetary / maxMon) * 5));
    const rfm = rScore * 100 + fScore * 10 + mScore;
    let segment = 'Low Value';
    if (rfm >= 444) segment = 'Champions';
    else if (rfm >= 333) segment = 'Loyal';
    else if (rfm >= 222) segment = 'Potential';
    else if (rfm >= 111) segment = 'At Risk';
    return { ...r, rScore, fScore, mScore, rfm, segment };
  });

  res.json({ customers: scored });
});

// ============ DELIVERY RATES CRUD ============

app.patch('/api/delivery/rates/:id', authMiddleware, (req, res) => {
  const storeId = req.storeId;
  const rateId = req.params.id;
  const { wilaya, commune, home_delivery_fee, stop_desk_fee } = req.body;

  const rate = db.prepare('SELECT * FROM delivery_rates WHERE id = ? AND store_id = ?').get(rateId, storeId);
  if (!rate) {
    return res.status(404).json({ error: 'Rate not found' });
  }

  db.prepare(`UPDATE delivery_rates SET
    wilaya = COALESCE(?, wilaya),
    commune = COALESCE(?, commune),
    home_delivery_fee = COALESCE(?, home_delivery_fee),
    stop_desk_fee = COALESCE(?, stop_desk_fee)
    WHERE id = ?
  `).run(wilaya || null, commune || null, home_delivery_fee !== undefined ? home_delivery_fee : null, stop_desk_fee !== undefined ? stop_desk_fee : null, rateId);

  const updated = db.prepare('SELECT * FROM delivery_rates WHERE id = ?').get(rateId);
  res.json(updated);
});

app.delete('/api/delivery/rates/:id', authMiddleware, (req, res) => {
  const storeId = req.storeId;
  const rateId = req.params.id;
  const rate = db.prepare('SELECT * FROM delivery_rates WHERE id = ? AND store_id = ?').get(rateId, storeId);
  if (!rate) {
    return res.status(404).json({ error: 'Rate not found' });
  }
  db.prepare('DELETE FROM delivery_rates WHERE id = ?').run(rateId);
  res.json({ success: true });
});

// ============ PRODUCTS: DELETE ============

app.delete('/api/products/:id', authMiddleware, (req, res) => {
  const storeId = req.storeId;
  const productId = req.params.id;
  const product = db.prepare('SELECT id FROM products WHERE id = ? AND store_id = ?').get(productId, storeId);
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }
  db.prepare('DELETE FROM products WHERE id = ?').run(productId);
  res.json({ success: true });
});

// ============ PUBLIC STOREFRONT API ============

// Verify store by slug + api_key
function verifyStorefront(req, res, next) {
  const { slug } = req.params;
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }
  const store = db.prepare('SELECT id, name, slug FROM stores WHERE slug = ? AND api_key = ?').get(slug, apiKey);
  if (!store) {
    return res.status(403).json({ error: 'Invalid store or API key' });
  }
  req.storefront = store;
  next();
}

// Public: list products for a store
app.get('/api/storefront/:slug/products', verifyStorefront, (req, res) => {
  const storeId = req.storefront.id;
  const products = db.prepare('SELECT * FROM products WHERE store_id = ? ORDER BY created_at DESC').all(storeId);
  res.json({ products });
});

// Public: create order from storefront
app.post('/api/storefront/:slug/orders', verifyStorefront, (req, res) => {
  const storeId = req.storefront.id;
  const { customer_name, customer_phone, customer_wilaya, customer_commune, delivery_type, items, cod_amount, shipping_fee = 0, notes } = req.body;

  if (!customer_name || !customer_phone || !items || !cod_amount) {
    return res.status(400).json({ error: 'customer_name, customer_phone, items, cod_amount required' });
  }

  // Auto-create customer if not exists
  let customer = db.prepare('SELECT id FROM customers WHERE store_id = ? AND phone = ?').get(storeId, customer_phone);
  if (!customer) {
    const result = db.prepare('INSERT INTO customers (store_id, name, phone, wilaya, total_orders, total_spend) VALUES (?, ?, ?, ?, 0, 0)').run(storeId, customer_name, customer_phone, customer_wilaya || null);
    customer = { id: result.lastInsertRowid };
  } else {
    db.prepare('UPDATE customers SET name = COALESCE(?, name), wilaya = COALESCE(?, wilaya) WHERE id = ?').run(customer_name, customer_wilaya || null, customer.id);
  }

  const orderNumber = 'BS-' + Math.floor(100000 + Math.random() * 900000);
  const subtotal = parseFloat(cod_amount) - parseFloat(shipping_fee || 0);
  const result = db.prepare(`
    INSERT INTO orders (store_id, customer_id, order_number, customer_name, customer_phone, customer_wilaya, customer_commune, delivery_type, items, subtotal, cod_amount, shipping_fee, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(storeId, customer.id, orderNumber, customer_name, customer_phone, customer_wilaya, customer_commune, delivery_type || 'Home Delivery', items, subtotal, cod_amount, shipping_fee, notes || null);

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(order);
});

// Public: track visitor
app.post('/api/storefront/:slug/visitors/track', (req, res) => {
  const { slug } = req.params;
  const { page, country, device, cart_status } = req.body;
  const store = db.prepare('SELECT id FROM stores WHERE slug = ?').get(slug);
  if (!store) {
    return res.status(404).json({ error: 'Store not found' });
  }
  const sessionId = req.body.session_id || 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  db.prepare('INSERT INTO visitors (store_id, session_id, page, country, device, cart_status) VALUES (?, ?, ?, ?, ?, ?)').run(store.id, sessionId, page || '/', country || 'Unknown', device || 'Unknown', cart_status || 'Browsing');
  res.status(201).json({ success: true });
});

// ============ SERVE FRONTEND ============

// Serve Boutique SALI storefront pages
const saliDir = path.join(__dirname, '..', 'public', 'sali');
app.get('/sali', (req, res) => res.sendFile(path.join(saliDir, 'index.html')));
app.get('/sali/index.html', (req, res) => res.sendFile(path.join(saliDir, 'index.html')));
app.get('/sali/shop.html', (req, res) => res.sendFile(path.join(saliDir, 'shop.html')));
app.get('/sali/product.html', (req, res) => res.sendFile(path.join(saliDir, 'product.html')));
app.get('/sali/about.html', (req, res) => res.sendFile(path.join(saliDir, 'about.html')));
app.get('/sali/contact.html', (req, res) => res.sendFile(path.join(saliDir, 'contact.html')));

// Serve default frontend for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`StorePulse running on http://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
});
