/**
 * 7 Грама Студио Аеродром - Backend Server
 * Email order functionality with Nodemailer
 */

const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const STATIC_ROOT = path.join(__dirname, '..');

// Middleware
app.disable('x-powered-by');
try {
    const compression = require('compression');
    app.use(compression());
} catch (error) {
    console.warn('compression middleware not installed; continuing without HTTP compression');
}
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(STATIC_ROOT, {
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
        if (/\.(css|js|png|jpe?g|webp|gif|svg|ico|mp4)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            return;
        }

        if (/\.html$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
            return;
        }

        res.setHeader('Cache-Control', 'public, max-age=3600');
    }
}));

// Email configuration
const emailConfig = {
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
        user: (process.env.EMAIL_USER || '').trim(),
        pass: (process.env.EMAIL_PASS || '').replace(/\s+/g, '')
    }
};

// Company email where orders will be sent
const COMPANY_EMAIL = process.env.COMPANY_EMAIL || emailConfig.auth.user;

function isEmailServiceConfigured() {
    return Boolean(emailConfig.auth.user && emailConfig.auth.pass && COMPANY_EMAIL);
}

function createTransporter() {
    return nodemailer.createTransport({
        host: emailConfig.host,
        port: emailConfig.port,
        secure: emailConfig.secure,
        auth: {
            user: emailConfig.auth.user,
            pass: emailConfig.auth.pass
        }
    });
}

function getMailFailureResponse(error, fallbackMessage) {
    if (error && (error.code === 'EAUTH' || error.responseCode === 534 || error.responseCode === 535)) {
        return {
            status: 503,
            body: {
                success: false,
                message: 'Email service authentication failed. Check EMAIL_USER and EMAIL_PASS.'
            }
        };
    }

    if (error && ['ECONNECTION', 'ESOCKET', 'ETIMEDOUT'].includes(error.code)) {
        return {
            status: 503,
            body: {
                success: false,
                message: 'Email service is temporarily unavailable. Please try again later.'
            }
        };
    }

    return {
        status: 500,
        body: {
            success: false,
            message: fallbackMessage
        }
    };
}

// Order endpoint
app.post('/api/send-order', async (req, res) => {
    try {
        if (!isEmailServiceConfigured()) {
            return res.status(503).json({
                success: false,
                message: 'Email service is not configured. Set EMAIL_USER, EMAIL_PASS, and COMPANY_EMAIL.'
            });
        }

        const orderData = req.body;
        
        if (!orderData.customer || !orderData.products || !orderData.total) {
            return res.status(400).json({
                success: false,
                message: 'Невалидни податоци за нарачката'
            });
        }
        
        const { customer, products, subtotal, delivery, total, orderDate } = orderData;
        const subtotalAmount = typeof subtotal === 'number'
            ? subtotal
            : products.reduce((sum, product) => sum + Number(product.total || 0), 0);
        const deliveryAmount = typeof delivery === 'number'
            ? delivery
            : Math.max(0, Number(total) - subtotalAmount);
        
        const emailSubject = 'Нова нарачка од ' + customer.firstName + ' ' + customer.lastName;
        
        let productsHtml = '';
        products.forEach(product => {
            productsHtml += '<tr>';
            productsHtml += '<td style="padding: 10px; border-bottom: 1px solid #eee;">' + product.name + '</td>';
            productsHtml += '<td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center;">' + product.quantity + '</td>';
            productsHtml += '<td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">' + product.price.toFixed(2) + ' ден.</td>';
            productsHtml += '<td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">' + product.total.toFixed(2) + ' ден.</td>';
            productsHtml += '</tr>';
        });

        if (deliveryAmount > 0) {
            productsHtml += '<tr>';
            productsHtml += '<td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Достава</strong></td>';
            productsHtml += '<td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center;">1</td>';
            productsHtml += '<td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">' + deliveryAmount.toFixed(2) + ' ден.</td>';
            productsHtml += '<td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">' + deliveryAmount.toFixed(2) + ' ден.</td>';
            productsHtml += '</tr>';
        }
        
        let noteRow = '';
        if (customer.note) {
            noteRow = '<tr><td style="padding: 8px;"><strong>Забелешка:</strong></td><td style="padding: 8px;">' + customer.note + '</td></tr>';
        }
        
        const emailHtml = 
        '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>' +
        '<div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">' +
        '<div style="background: #8B0000; color: white; padding: 20px; text-align: center;">' +
        '<h1>7 Грама Студио Аеродром</h1><p>Нова нарачка</p></div>' +
        '<div style="padding: 20px; background: #f9f9f9;">' +
        '<h2>Податоци за корисникот</h2>' +
        '<table style="width: 100%; border-collapse: collapse;">' +
        '<tr><td style="padding: 8px;"><strong>Име и презиме:</strong></td><td style="padding: 8px;">' + customer.firstName + ' ' + customer.lastName + '</td></tr>' +
        '<tr><td style="padding: 8px;"><strong>Телефон:</strong></td><td style="padding: 8px;">' + customer.phone + '</td></tr>' +
        '<tr><td style="padding: 8px;"><strong>Е-маил:</strong></td><td style="padding: 8px;">' + customer.email + '</td></tr>' +
        '<tr><td style="padding: 8px;"><strong>Адреса:</strong></td><td style="padding: 8px;">' + customer.address + '</td></tr>' +
        '<tr><td style="padding: 8px;"><strong>Град:</strong></td><td style="padding: 8px;">' + customer.city + '</td></tr>' +
        noteRow +
        '</table>' +
        '<h2>Производи во нарачката</h2>' +
        '<table style="width: 100%; border-collapse: collapse;">' +
        '<thead><tr><th style="padding: 12px; background: #333; color: white; text-align: left;">Производ</th><th style="padding: 12px; background: #333; color: white; text-align: center;">Количина</th><th style="padding: 12px; background: #333; color: white; text-align: right;">Цена</th><th style="padding: 12px; background: #333; color: white; text-align: right;">Вкупна цена</th></tr></thead>' +
        '<tbody>' + productsHtml + '</tbody>' +
        '<tfoot><tr><td colspan="3" style="padding: 15px; text-align: right;"><strong>Вкупна сума:</strong></td><td style="padding: 15px; text-align: right; font-size: 18px; font-weight: bold; color: #8B0000;">' + total.toFixed(2) + ' ден.</td></tr></tfoot>' +
        '</table>' +
        '<p><strong>Датум на нарачката:</strong> ' + orderDate + '</p>' +
        '</div>' +
        '<div style="text-align: center; padding: 20px; color: #666; font-size: 12px;">' +
        '<p>© 2026 7 Грама Студио Аеродром. Сите права се задржани.</p>' +
        '</div></div></body></html>';
        
        const transporter = createTransporter();
        
        await transporter.sendMail({
            from: '"7 Грама Студио Аеродром" <' + emailConfig.auth.user + '>',
            to: COMPANY_EMAIL,
            subject: emailSubject,
            html: emailHtml
        });
        
        res.json({
            success: true,
            message: 'Нарачката е испратена успешно'
        });
        
    } catch (error) {
        console.error('Error sending email:', error);
        const failure = getMailFailureResponse(error, 'Грешка при испраќање на нарачката');
        return res.status(failure.status).json(failure.body);
        res.status(500).json({
            success: false,
            message: 'Грешка при испраќање на нарачката'
        });
    }
});

// Contact form endpoint
app.post('/api/send-contact', async (req, res) => {
    try {
        if (!isEmailServiceConfigured()) {
            return res.status(503).json({
                success: false,
                message: 'Email service is not configured. Set EMAIL_USER, EMAIL_PASS, and COMPANY_EMAIL.'
            });
        }

        const { firstName, lastName, email, message } = req.body;
        
        if (!firstName || !lastName || !email || !message) {
            return res.status(400).json({
                success: false,
                message: 'Сите полиња се задолжителни'
            });
        }
        
        const emailHtml = 
        '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>' +
        '<div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">' +
        '<div style="background: #8B0000; color: white; padding: 20px; text-align: center;">' +
        '<h1>7 Грама Студио Аеродром</h1><p>Нова порака од контакт форма</p></div>' +
        '<div style="padding: 20px; background: #f9f9f9;">' +
        '<h2>Податоци за корисникот</h2>' +
        '<p><strong>Име и презиме:</strong> ' + firstName + ' ' + lastName + '</p>' +
        '<p><strong>Е-маил:</strong> ' + email + '</p>' +
        '<h2>Порака:</h2>' +
        '<p>' + message.replace(/\n/g, '<br>') + '</p>' +
        '</div>' +
        '<div style="text-align: center; padding: 20px; color: #666; font-size: 12px;">' +
        '<p>© 2026 7 Грама Студио Аеродром. Сите права се задржани.</p>' +
        '</div></div></body></html>';
        
        const transporter = createTransporter();
        
        await transporter.sendMail({
            from: '"7 Грама Студио Аеродром" <' + emailConfig.auth.user + '>',
            to: COMPANY_EMAIL,
            subject: 'Контакт порака од ' + firstName + ' ' + lastName,
            html: emailHtml
        });
        
        res.json({
            success: true,
            message: 'Пораката е испратена успешно'
        });
        
    } catch (error) {
        console.error('Error sending contact email:', error);
        const failure = getMailFailureResponse(error, 'Грешка при испраќање на пораката');
        return res.status(failure.status).json(failure.body);
        res.status(500).json({
            success: false,
            message: 'Грешка при испраќање на пораката'
        });
    }
});

// Serve static files
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
});

app.get('/cart', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'cart.html'));
});

app.get('/checkout', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'checkout.html'));
});

// Start server
app.listen(PORT, () => {
    console.log('7 Грама Студио Аеродром - Server running on port ' + PORT);
    console.log('Visit: http://localhost:' + PORT);
});
