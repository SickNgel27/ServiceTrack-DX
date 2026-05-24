const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- CONFIGURACIÓN DE CORREO (NODEMAILER) ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: 'angelitojpg2705@gmail.com', pass: 'Angelito2785' } 
});

// --- CONFIGURACIÓN DE IMÁGENES ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, 'public/uploads');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => { cb(null, 'ticket-' + Date.now() + path.extname(file.originalname)); }
});
const upload = multer({ storage: storage });

// --- CONEXIÓN A LA BASE DE DATOS ---
const pool = mysql.createPool({ host: 'localhost', user: 'root', password: 'Distelsa2026', database: 'servicetrack_dx' }).promise(); 

// --- API LOGIN ---
app.post('/api/login', async (req, res) => {
    const { user, pass, role } = req.body;
    try {
        const [rows] = await pool.query('SELECT nombre_completo, rol FROM usuarios WHERE usuario = ? AND password = ? AND rol = ?', [user, pass, role.toUpperCase()]);
        if (rows.length > 0) res.json({ success: true, usuario: rows[0] }); else res.status(401).json({ success: false, mensaje: "Acceso Denegado" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- API ASESOR: INGRESO FORMAL ---
app.post('/api/tickets', upload.array('fotos', 5), async (req, res) => {
    const { cliente, email, tel, modelo, serie, falla } = req.body;
    try {
        const [resCli] = await pool.query('INSERT INTO clientes (nombre, telefono, email) VALUES (?, ?, ?)', [cliente, tel, email]);
        const [resTick] = await pool.query('INSERT INTO tickets (id_cliente, modelo_equipo, serie, falla, id_estado) VALUES (?, ?, ?, ?, 1)', [resCli.insertId, modelo, serie, falla]);
        
        if (req.files && req.files.length > 0) {
            for (let file of req.files) await pool.query('INSERT INTO evidencias (id_ticket, ruta_imagen) VALUES (?, ?)', [resTick.insertId, `/uploads/${file.filename}`]);
        }

        await pool.query("INSERT INTO notificaciones (rol_destino, mensaje) VALUES ('TECNICO', ?)", [`Nueva orden de servicio ingresada: Orden #${resTick.insertId} (${modelo})`]);

        const mailOptions = {
            from: 'ServiceTrack DX', to: email, subject: `Comprobante de Ingreso - Orden #${resTick.insertId}`,
            html: `<h2 style="color: #004085;">ServiceTrack DX - Comprobante de Ingreso</h2>
                   <p>Estimado/a <b>${cliente}</b>,</p>
                   <p>Su equipo <b>${modelo}</b> (Serie: ${serie}) ha sido ingresado a nuestro taller exitosamente.</p>
                   <p><b>Falla reportada:</b> ${falla}</p>
                   <p>Le notificaremos por esta vía y por WhatsApp cuando nuestro equipo técnico finalice el diagnóstico.</p>
                   <p>Atentamente,<br>El equipo de soporte técnico.</p>`
        };
        transporter.sendMail(mailOptions).catch(console.error);

        res.json({ success: true, id: resTick.insertId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- API GENERAL ---
app.get('/api/tickets/all', async (req, res) => {
    try {
        const [rows] = await pool.query(`SELECT t.*, c.nombre as cliente, c.telefono, c.email, e.nombre_estado, DATEDIFF(NOW(), t.fecha_ingreso) as dias, (SELECT ruta_imagen FROM evidencias ev WHERE ev.id_ticket = t.id_ticket LIMIT 1) as foto_evidencia FROM tickets t JOIN clientes c ON t.id_cliente = c.id_cliente JOIN estados e ON t.id_estado = e.id_estado ORDER BY t.id_ticket DESC`);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- API WORKFLOW ---
app.put('/api/tickets/:id/diagnostico', async (req, res) => {
    const { id } = req.params; const { diagnostico, repuestos_txt, mo, rep } = req.body;
    try {
        await pool.query('UPDATE tickets SET diagnostico_tecnico = ?, detalle_repuestos = ?, costo_mo = ?, costo_rep = ?, id_estado = 4 WHERE id_ticket = ?', [diagnostico, repuestos_txt, mo, rep, id]);
        await pool.query("INSERT INTO notificaciones (rol_destino, mensaje) VALUES ('ASESOR', ?)", [`La orden #${id} ha sido presupuestada. Esperando autorización del cliente.`]);

        const [info] = await pool.query('SELECT c.email, c.nombre, t.modelo_equipo FROM clientes c JOIN tickets t ON c.id_cliente = t.id_cliente WHERE t.id_ticket = ?', [id]);
        if (info.length > 0) {
            const total = (parseFloat(mo) + parseFloat(rep)).toFixed(2);
            const mailOptions = {
                from: 'ServiceTrack DX', to: info[0].email, subject: `Diagnóstico y Presupuesto - Orden #${id}`,
                html: `<h2 style="color: #004085;">ServiceTrack DX - Notificación de Diagnóstico</h2>
                       <p>Estimado/a <b>${info[0].nombre}</b>,</p>
                       <p>Hemos finalizado la evaluación técnica de su equipo: <b>${info[0].modelo_equipo}</b>.</p>
                       <table border="1" cellpadding="10" cellspacing="0" style="border-collapse: collapse; width: 100%; max-width: 600px;">
                           <tr><td style="background-color: #f8fafc;"><b>Diagnóstico Técnico:</b></td><td>${diagnostico}</td></tr>
                           <tr><td style="background-color: #f8fafc;"><b>Repuestos Requeridos:</b></td><td>${repuestos_txt}</td></tr>
                           <tr><td style="background-color: #f8fafc;"><b>Costo Total:</b></td><td><b>Q${total}</b></td></tr>
                       </table>
                       <p>Se ha enviado un mensaje a su número de WhatsApp con los enlaces seguros para autorizar o rechazar la reparación.</p>`
            };
            transporter.sendMail(mailOptions).catch(console.error);
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- API DE ESTADOS Y NOTIFICACIONES A GERENCIA ---
app.put('/api/tickets/:id/estado', async (req, res) => {
    const { id } = req.params; const { id_estado } = req.body;
    try {
        await pool.query('UPDATE tickets SET id_estado = ? WHERE id_ticket = ?', [id_estado, id]);
        
        // NOTIFICACIONES DINÁMICAS
        if(id_estado == 3) {
            await pool.query("INSERT INTO notificaciones (rol_destino, mensaje) VALUES ('GERENCIA', ?)", [`Alerta Operativa: La orden #${id} se encuentra pausada en espera de repuestos.`]);
        }
        else if (id_estado == 5) {
           
            await pool.query("INSERT INTO notificaciones (rol_destino, mensaje) VALUES ('GERENCIA', ?)", [`Aviso: La orden #${id} cuenta con los recursos y ha retomado su reparación.`]);
        }
        else if(id_estado == 8) {
            await pool.query("INSERT INTO notificaciones (rol_destino, mensaje) VALUES ('GERENCIA', ?)", [`La orden #${id} fue entregada exitosamente al cliente.`]);
        }

        const [info] = await pool.query('SELECT c.email, c.nombre, t.modelo_equipo, (t.costo_mo + t.costo_rep) as total FROM clientes c JOIN tickets t ON c.id_cliente = t.id_cliente WHERE t.id_ticket = ?', [id]);
        if (info.length > 0 && id_estado == 7) {
            transporter.sendMail({
                from: 'ServiceTrack DX', to: info[0].email, subject: `Equipo Listo para Retiro - Orden #${id}`,
                html: `<h2 style="color: #004085;">ServiceTrack DX</h2>
                       <p>Estimado/a <b>${info[0].nombre}</b>,</p>
                       <p>Su equipo <b>${info[0].modelo_equipo}</b> se encuentra reparado y listo para ser entregado.</p>
                       <p><b>Saldo a cancelar: Q${parseFloat(info[0].total).toFixed(2)}</b></p>`
            }).catch(console.error);
        }

        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- API NOTIFICACIONES ---
app.get('/api/notificaciones/:rol', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM notificaciones WHERE rol_destino = ? AND leido = 0 ORDER BY fecha DESC', [req.params.rol.toUpperCase()]);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/notificaciones/marcar/:id', async (req, res) => {
    await pool.query('UPDATE notificaciones SET leido = 1 WHERE id_notif = ?', [req.params.id]); res.json({success: true});
});

// --- API BOT: DECISIÓN DEL CLIENTE ---
app.get('/api/chatbot/respuesta/:id/:decision', async (req, res) => {
    const { id, decision } = req.params;
    let id_estado = decision === 'apruebo' ? 5 : 6;
    let txtDecision = decision === 'apruebo' ? 'APROBÓ' : 'RECHAZÓ';

    try {
        await pool.query('UPDATE tickets SET id_estado = ? WHERE id_ticket = ?', [id_estado, id]);
        await pool.query("INSERT INTO notificaciones (rol_destino, mensaje) VALUES ('TECNICO', ?)", [`Aviso: El cliente de la Orden #${id} ${txtDecision} el presupuesto.`]);
        
        if (id_estado == 5) {
            const [info] = await pool.query('SELECT c.email, c.nombre, t.modelo_equipo FROM clientes c JOIN tickets t ON c.id_cliente = t.id_cliente WHERE t.id_ticket = ?', [id]);
            if (info.length > 0) {
                transporter.sendMail({
                    from: 'ServiceTrack DX', to: info[0].email, subject: `Actualización de Estado - Orden #${id}`,
                    html: `<h2 style="color: #004085;">ServiceTrack DX</h2><p>Estimado/a <b>${info[0].nombre}</b>,</p><p>Hemos recibido su autorización. Su equipo <b>${info[0].modelo_equipo}</b> ha entrado a la fase de reparación.</p>`
                }).catch(console.error);
            }
        }

        res.send(`
            <div style="font-family: sans-serif; text-align: center; margin-top: 50px; color: #004085;">
                <h1 style="font-size: 2rem;">Confirmación de Sistema</h1>
                <h2 style="color: ${decision === 'apruebo' ? '#10b981' : '#ef4444'};">ESTADO: ${txtDecision}</h2>
                <p>Su respuesta ha sido registrada exitosamente en nuestro sistema.</p>
                <p>El técnico asignado ha sido notificado.</p>
                <p style="color: gray; font-size: 12px; margin-top: 30px;">Puede cerrar esta ventana de manera segura.</p>
            </div>
        `);
    } catch (err) { res.status(500).send("Error procesando su solicitud en el servidor."); }
});

// --- API GERENCIA (KPIS) ---
app.get('/api/gerencia/kpis', async (req, res) => {
    try {
        const [total] = await pool.query('SELECT COUNT(*) as count FROM tickets');
        const [diaco] = await pool.query('SELECT COUNT(*) as count FROM tickets WHERE DATEDIFF(NOW(), fecha_ingreso) > 25');
        const [estados] = await pool.query('SELECT e.nombre_estado, COUNT(t.id_ticket) as cantidad FROM estados e LEFT JOIN tickets t ON e.id_estado = t.id_estado GROUP BY e.nombre_estado');
        const [ingresos] = await pool.query('SELECT SUM(costo_mo + costo_rep) as total FROM tickets WHERE id_estado = 8');
        res.json({ totales: total[0].count, diaco: diaco[0].count, dinero: ingresos[0].total || 0, grafica_estados: estados });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(5000, () => console.log("🚀 ST-DX ONLINE: http://localhost:5000"));
