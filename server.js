const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ========== تهيئة Firebase Admin ==========
let firebaseConfig;
try {
  // قراءة إعدادات Firebase من .env
  firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
  console.log('✅ تم قراءة إعدادات Firebase بنجاح');
} catch (error) {
  console.error('❌ خطأ في قراءة FIREBASE_CONFIG من .env:', error.message);
  process.exit(1);
}

// تهيئة Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(firebaseConfig)
});

const db = admin.firestore();
console.log('✅ Firebase Firestore متصل بنجاح');

// ========== Middleware ==========
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ========== إعدادات Telegram ==========
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_IDS = process.env.TELEGRAM_CHAT_ID.split(',').map(id => id.trim());

// دالة إرسال رسالة لجميع Chat IDs
async function sendTelegramMessage(message) {
  if (!TELEGRAM_TOKEN) {
    console.log('⚠️ TELEGRAM_TOKEN غير موجود في .env');
    return;
  }

  const results = [];
  for (const chatId of TELEGRAM_CHAT_IDS) {
    try {
      const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
      const response = await axios.post(url, {
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML'
      });
      results.push({ chatId, success: true });
      console.log(`✅ تم إرسال الإشعار إلى Telegram (${chatId})`);
    } catch (error) {
      console.error(`❌ فشل إرسال الإشعار إلى ${chatId}:`, error.response?.data || error.message);
      results.push({ chatId, success: false, error: error.message });
    }
  }
  return results;
}

// دالة تنسيق رسالة الطلب
function formatOrderMessage(order) {
  const itemsList = order.items.map(item => 
    `  • ${item.name} - ${item.type === 'rent' ? 'إيجار' : 'شراء'} (${item.quantity} × ${item.price} ج.م)`
  ).join('\n');
  
  return `
🛍️ <b>طلب جديد!</b>
━━━━━━━━━━━━━━
<b>📋 رقم الطلب:</b> #${order.id}
<b>👤 اسم العميل:</b> ${order.customerName}
<b>📞 رقم الهاتف:</b> ${order.customerPhone}
<b>📅 التاريخ:</b> ${new Date(order.date).toLocaleString('ar-EG')}

<b>🛒 المنتجات:</b>
${itemsList}

<b>💰 الإجمالي:</b> ${order.total} ج.م
<b>💳 طريقة الدفع:</b> ${order.paymentMethod}

━━━━━━━━━━━━━━
✅ تم استلام طلب جديد، يرجى التجهيز
  `;
}

// ========== JWT Middleware ==========
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ message: 'غير مصرح بالوصول' });
  }
  
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'توكن غير صالح' });
    }
    req.user = user;
    next();
  });
};

// ========== API Routes ==========

// تسجيل الدخول
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    const token = jwt.sign({ username: username, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, message: 'تم تسجيل الدخول بنجاح' });
  } else {
    res.status(401).json({ message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  }
});

// التحقق من صحة التوكن
app.post('/api/verify-token', authenticateToken, (req, res) => {
  res.json({ valid: true, user: req.user });
});

// الحصول على جميع الطلبات من Firebase
app.get('/api/orders', authenticateToken, async (req, res) => {
  try {
    const ordersSnapshot = await db.collection('orders').orderBy('date', 'desc').get();
    const orders = [];
    ordersSnapshot.forEach(doc => {
      orders.push({ id: doc.id, ...doc.data() });
    });
    res.json(orders);
  } catch (error) {
    console.error('خطأ في جلب الطلبات:', error);
    res.status(500).json({ message: 'خطأ في جلب الطلبات', error: error.message });
  }
});

// إضافة طلب جديد وإرسال إشعار Telegram
app.post('/api/orders', async (req, res) => {
  try {
    const order = req.body;
    order.orderDate = new Date().toISOString();
    order.status = 'pending';
    
    // حفظ الطلب في Firebase
    const docRef = await db.collection('orders').add(order);
    const savedOrder = { id: docRef.id, ...order };
    
    // إرسال إشعار Telegram لجميع الـ Chat IDs
    const message = formatOrderMessage(savedOrder);
    await sendTelegramMessage(message);
    
    res.status(201).json({ 
      message: 'تم حفظ الطلب بنجاح وإرسال الإشعار', 
      order: savedOrder 
    });
  } catch (error) {
    console.error('خطأ في حفظ الطلب:', error);
    res.status(500).json({ message: 'خطأ في حفظ الطلب', error: error.message });
  }
});

// تحديث حالة الطلب
app.put('/api/orders/:id', authenticateToken, async (req, res) => {
  try {
    const orderId = req.params.id;
    const { status } = req.body;
    
    await db.collection('orders').doc(orderId).update({ 
      status: status,
      updatedAt: new Date().toISOString()
    });
    
    // إرسال إشعار تحديث الحالة إلى Telegram
    const statusMessage = `
🔄 <b>تحديث حالة طلب</b>
━━━━━━━━━━━━━━
<b>📋 رقم الطلب:</b> #${orderId}
<b>📊 الحالة الجديدة:</b> ${status === 'completed' ? '✅ مكتمل' : status === 'cancelled' ? '❌ ملغي' : '⏳ قيد المعالجة'}
━━━━━━━━━━━━━━
    `;
    await sendTelegramMessage(statusMessage);
    
    res.json({ message: 'تم تحديث حالة الطلب بنجاح' });
  } catch (error) {
    console.error('خطأ في تحديث الطلب:', error);
    res.status(500).json({ message: 'خطأ في تحديث الطلب' });
  }
});

// حذف طلب
app.delete('/api/orders/:id', authenticateToken, async (req, res) => {
  try {
    const orderId = req.params.id;
    await db.collection('orders').doc(orderId).delete();
    res.json({ message: 'تم حذف الطلب بنجاح' });
  } catch (error) {
    console.error('خطأ في حذف الطلب:', error);
    res.status(500).json({ message: 'خطأ في حذف الطلب' });
  }
});

// إحصائيات الطلبات
app.get('/api/stats', authenticateToken, async (req, res) => {
  try {
    const ordersSnapshot = await db.collection('orders').get();
    const orders = [];
    ordersSnapshot.forEach(doc => {
      orders.push(doc.data());
    });
    
    const totalOrders = orders.length;
    const totalRevenue = orders.reduce((sum, order) => sum + (order.total || 0), 0);
    const buyOrders = orders.reduce((sum, order) => sum + (order.items?.filter(item => item.type === 'buy').length || 0), 0);
    const rentOrders = orders.reduce((sum, order) => sum + (order.items?.filter(item => item.type === 'rent').length || 0), 0);
    
    res.json({
      totalOrders,
      totalRevenue,
      buyOrders,
      rentOrders
    });
  } catch (error) {
    console.error('خطأ في جلب الإحصائيات:', error);
    res.status(500).json({ message: 'خطأ في جلب الإحصائيات' });
  }
});

// ========== Routes للصفحات ==========
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/pay', (req, res) => {
  res.sendFile(path.join(__dirname, 'pay.html'));
});

// ========== تشغيل الخادم ==========
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════╗
║     🚀 الخادم يعمل بنجاح!                   ║
╠════════════════════════════════════════════╣
║  📍 http://localhost:${PORT}                  ║
║  🔐 لوحة التحكم: /login                     ║
║  👤 admin / ${process.env.ADMIN_PASS}        ║
║  💾 Firebase: ✅ متصل                       ║
║  🤖 Telegram: ✅ جاهز (${TELEGRAM_CHAT_IDS.length} Chat IDs) ║
╚════════════════════════════════════════════╝
  `);
});
