const nodemailer = require('nodemailer');

function json(statusCode, body) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify(body)
    };
}

function parseRequestBody(event) {
    if (!event || !event.body) return {};

    let raw = event.body;
    if (event.isBase64Encoded) {
        raw = Buffer.from(raw, 'base64').toString('utf8');
    }

    try {
        return JSON.parse(raw);
    } catch (error) {
        throw new Error('INVALID_JSON');
    }
}

function getMailFailureResponse(error, fallbackMessage) {
    if (error && (error.code === 'EAUTH' || error.responseCode === 534 || error.responseCode === 535)) {
        return json(503, { success: false, message: 'Email service authentication failed. Check EMAIL_USER and EMAIL_PASS.' });
    }

    if (error && ['ECONNECTION', 'ESOCKET', 'ETIMEDOUT'].includes(error.code)) {
        return json(503, { success: false, message: 'Email service is temporarily unavailable. Please try again later.' });
    }

    return json(500, { success: false, message: fallbackMessage });
}

exports.handler = async function handler(event) {
    if (event.httpMethod !== 'POST') {
        return json(405, { success: false, message: 'Method not allowed' });
    }

    const EMAIL_USER = (process.env.EMAIL_USER || '').trim();
    const EMAIL_PASS = (process.env.EMAIL_PASS || '').replace(/\s+/g, '');
    const COMPANY_EMAIL = process.env.COMPANY_EMAIL || EMAIL_USER;

    if (!EMAIL_USER || !EMAIL_PASS || !COMPANY_EMAIL) {
        return json(503, { success: false, message: 'Email service is not configured. Set EMAIL_USER, EMAIL_PASS, and COMPANY_EMAIL.' });
    }

    try {
        let orderData = {};
        try {
            orderData = parseRequestBody(event);
        } catch (error) {
            return json(400, { success: false, message: 'Invalid request body.' });
        }
        const { customer, products, subtotal, delivery, total, orderDate } = orderData;
        const subtotalAmount = typeof subtotal === 'number'
            ? subtotal
            : products.reduce(function(sum, product) {
                return sum + Number(product.total || 0);
            }, 0);
        const deliveryAmount = typeof delivery === 'number'
            ? delivery
            : Math.max(0, Number(total) - subtotalAmount);

        if (!customer || !Array.isArray(products) || typeof total !== 'number') {
            return json(400, { success: false, message: 'Невалидни податоци за нарачката' });
        }

        const transporter = nodemailer.createTransport({
            host: 'smtp.gmail.com',
            port: 587,
            secure: false,
            auth: {
                user: EMAIL_USER,
                pass: EMAIL_PASS
            }
        });

        let productsHtml = '';
        products.forEach(function (product) {
            productsHtml += '<tr>' +
                '<td style="padding: 10px; border-bottom: 1px solid #eee;">' + product.name + '</td>' +
                '<td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center;">' + product.quantity + '</td>' +
                '<td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">' + Number(product.price).toFixed(2) + ' ден.</td>' +
                '<td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">' + Number(product.total).toFixed(2) + ' ден.</td>' +
                '</tr>';
        });

        if (deliveryAmount > 0) {
            productsHtml += '<tr>' +
                '<td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>Достава</strong></td>' +
                '<td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center;">1</td>' +
                '<td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">' + Number(deliveryAmount).toFixed(2) + ' ден.</td>' +
                '<td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">' + Number(deliveryAmount).toFixed(2) + ' ден.</td>' +
                '</tr>';
        }

        const noteRow = customer.note
            ? '<tr><td style="padding: 8px;"><strong>Забелешка:</strong></td><td style="padding: 8px;">' + customer.note + '</td></tr>'
            : '';

        const emailHtml =
            '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>' +
            '<div style="max-width: 700px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">' +
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
            '<thead><tr>' +
            '<th style="padding: 12px; background: #333; color: white; text-align: left;">Производ</th>' +
            '<th style="padding: 12px; background: #333; color: white; text-align: center;">Количина</th>' +
            '<th style="padding: 12px; background: #333; color: white; text-align: right;">Цена</th>' +
            '<th style="padding: 12px; background: #333; color: white; text-align: right;">Вкупно</th>' +
            '</tr></thead><tbody>' + productsHtml + '</tbody>' +
            '<tfoot><tr><td colspan="3" style="padding: 15px; text-align: right;"><strong>Вкупна сума:</strong></td>' +
            '<td style="padding: 15px; text-align: right; font-size: 18px; font-weight: bold; color: #8B0000;">' + Number(total).toFixed(2) + ' ден.</td></tr></tfoot>' +
            '</table>' +
            '<p><strong>Датум на нарачката:</strong> ' + (orderDate || new Date().toLocaleString('mk-MK')) + '</p>' +
            '</div></div></body></html>';

        await transporter.sendMail({
            from: '"7 Грама Студио Аеродром" <' + EMAIL_USER + '>',
            to: COMPANY_EMAIL,
            subject: 'Нова нарачка од ' + customer.firstName + ' ' + customer.lastName,
            html: emailHtml
        });

        return json(200, { success: true, message: 'Нарачката е испратена успешно' });
    } catch (error) {
        console.error('send-order error:', error);
        return getMailFailureResponse(error, 'Грешка при испраќање на нарачката');
    }
};
