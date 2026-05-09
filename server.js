// server.js
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// مفتاح JWT السري
const JWT_SECRET = 'your-secret-key-change-this-in-production';
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'admin123';

// تخزين الطلبات (في الذاكرة - للعرض فقط، استخدم قاعدة بيانات في الإنتاج)
let orders = [];

// Middleware للتحقق من JWT
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ message: 'غير مصرح بالوصول' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'توكن غير صالح' });
        }
        req.user = user;
        next();
    });
};

// API Routes

// تسجيل الدخول
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        const token = jwt.sign({ username: username, role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, message: 'تم تسجيل الدخول بنجاح' });
    } else {
        res.status(401).json({ message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }
});

// التحقق من صحة التوكن
app.post('/api/verify-token', authenticateToken, (req, res) => {
    res.json({ valid: true, user: req.user });
});

// الحصول على جميع الطلبات (محمي)
app.get('/api/orders', authenticateToken, (req, res) => {
    res.json(orders);
});

// إضافة طلب جديد
app.post('/api/orders', (req, res) => {
    const order = req.body;
    order.orderDate = new Date().toISOString();
    orders.push(order);
    res.status(201).json({ message: 'تم حفظ الطلب بنجاح', order: order });
});

// حذف طلب (محمي)
app.delete('/api/orders/:id', authenticateToken, (req, res) => {
    const orderId = parseInt(req.params.id);
    const orderIndex = orders.findIndex(o => o.id === orderId);
    
    if (orderIndex !== -1) {
        orders.splice(orderIndex, 1);
        res.json({ message: 'تم حذف الطلب بنجاح' });
    } else {
        res.status(404).json({ message: 'الطلب غير موجود' });
    }
});

// إحصائيات الطلبات (محمي)
app.get('/api/stats', authenticateToken, (req, res) => {
    const totalOrders = orders.length;
    const totalRevenue = orders.reduce((sum, order) => sum + order.total, 0);
    const buyOrders = orders.reduce((sum, order) => sum + order.items.filter(item => item.type === 'buy').length, 0);
    const rentOrders = orders.reduce((sum, order) => sum + order.items.filter(item => item.type === 'rent').length, 0);
    
    res.json({
        totalOrders,
        totalRevenue,
        buyOrders,
        rentOrders
    });
});

// مسارات الصفحات
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
    // التحقق من وجود سلة مشتريات
    res.sendFile(path.join(__dirname, 'pay.html'));
});

// تشغيل الخادم
app.listen(PORT, () => {
    console.log(`✅ الخادم يعمل على http://localhost:${PORT}`);
    console.log(`📊 لوحة التحكم: http://localhost:${PORT}/login`);
    console.log(`👤 بيانات الدخول: admin / admin123`);
});
