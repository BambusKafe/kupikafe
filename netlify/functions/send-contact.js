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
        let payload = {};
        try {
            payload = parseRequestBody(event);
        } catch (error) {
            return json(400, { success: false, message: 'Invalid request body.' });
        }

        const { firstName, lastName, email, message } = payload;

        if (!firstName || !lastName || !email || !message) {
            return json(400, { success: false, message: 'Сите полиња се задолжителни' });
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

        const emailHtml =
            '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>' +
            '<div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">' +
            '<div style="background: #8B0000; color: white; padding: 20px; text-align: center;">' +
            '<h1>7 Грама Студио Аеродром</h1><p>Нова порака од контакт форма</p></div>' +
            '<div style="padding: 20px; background: #f9f9f9;">' +
            '<p><strong>Име и презиме:</strong> ' + firstName + ' ' + lastName + '</p>' +
            '<p><strong>Е-маил:</strong> ' + email + '</p>' +
            '<p><strong>Порака:</strong><br>' + String(message).replace(/\n/g, '<br>') + '</p>' +
            '</div></div></body></html>';

        await transporter.sendMail({
            from: '"7 Грама Студио Аеродром" <' + EMAIL_USER + '>',
            to: COMPANY_EMAIL,
            subject: 'Контакт порака од ' + firstName + ' ' + lastName,
            html: emailHtml
        });

        return json(200, { success: true, message: 'Пораката е испратена успешно' });
    } catch (error) {
        console.error('send-contact error:', error);
        return getMailFailureResponse(error, 'Грешка при испраќање на пораката');
    }
};
