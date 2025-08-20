import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pg from 'pg';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import admin from 'firebase-admin';
import fs from 'fs';
// update  
// Load environment variables
dotenv.config();

// Validate critical environment variables
const requiredEnvVars = ['DB_USER', 'DB_HOST', 'DB_NAME', 'DB_PASSWORD', 'DB_PORT', 'JWT_SECRET'];
const missingEnvVars = requiredEnvVars.filter((varName) => !process.env[varName]);
if (missingEnvVars.length > 0) {
  console.error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
  process.exit(1);
}

// Read the Firebase service account JSON file
let serviceAccount;
try {
  serviceAccount = JSON.parse(
    fs.readFileSync('C:/Users/roopa/leave_management1/serviceAccountKey.json', 'utf8')
  );
} catch (err) {
  console.error('Failed to read Firebase service account file:', err.message);
  process.exit(1);
}

// Initialize Firebase Admin SDK
try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
} catch (err) {
  console.error('Failed to initialize Firebase Admin SDK:', err.message);
  process.exit(1);
}

const { Pool } = pg;
const app = express();

// Middleware
app.use(cors());
app.use(express.json()); // Parses JSON bodies
app.use(express.urlencoded({ extended: true })); // Parses form-data

// Log all registered routes for debugging
const originalGet = app.get;
app.get = function (path, ...handlers) {
  console.log(`Registering GET route: ${path}`);
  return originalGet.call(this, path, ...handlers);
};

const originalPost = app.post;
app.post = function (path, ...handlers) {
  console.log(`Registering POST route: ${path}`);
  return originalPost.call(this, path, ...handlers);
};

const originalPut = app.put;
app.put = function (path, ...handlers) {
  console.log(`Registering PUT route: ${path}`);
  return originalPut.call(this, path, ...handlers);
};

// Database connection
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT, 10),
});

// Test database connection
pool.connect()
  .then(() => console.log('Database connected successfully'))
  .catch((err) => {
    console.error('Database connection error:', err.message);
    process.exit(1);
  });

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';
const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) || 10;
const HOST = process.env.HOST_IP || '0.0.0.0';
const PORT = process.env.PORT || 3000;

async function getApproversForEmployee(applicantEmpId) {
  const q = `
    SELECT
      fm.emp_id AS fla_emp_id,
      fm.name   AS fla_name,
      sm.emp_id AS sla_emp_id,
      sm.name   AS sla_name
    FROM seg_employee_details sd
    LEFT JOIN fla_master fm ON sd.fla = fm.id
    LEFT JOIN sla_master sm ON sd.sla = sm.id
    WHERE sd.emp_id = $1
    LIMIT 1
  `;
  const { rows } = await pool.query(q, [applicantEmpId]);
  return rows[0] || null;
}

async function getFcmTokensForEmpIds(empIds = []) {
  if (!empIds || !empIds.length) return [];
  const { rows } = await pool.query(
    `SELECT emp_id, fcm_token FROM seg_employee_details WHERE emp_id = ANY($1) AND fcm_token IS NOT NULL`,
    [empIds]
  );
  const seen = new Set();
  const tokens = [];
  for (const r of rows) {
    if (r.fcm_token && !seen.has(r.fcm_token)) {
      seen.add(r.fcm_token);
      tokens.push(r.fcm_token);
    }
  }
  return tokens;
}
async function sendMulticastToEmpIds(empIds = [], notification = {}, data = {}) {
  try {
    const tokens = await getFcmTokensForEmpIds(empIds);
    console.log('📲 FCM Tokens for approvers:', tokens);

    if (!tokens.length) {
      console.warn('⚠️ No FCM tokens found — notification will not be sent.');
      return { successCount: 0, failureCount: 0, invalidTokens: [] };
    }

    const dataStringified = {};
    for (const k of Object.keys(data || {})) {
      dataStringified[k] = String(data[k] ?? '');
    }

    const message = {
      tokens,
      notification,
      data: dataStringified,
    };

    // ✅ v13+ method
    const resp = await admin.messaging().sendEachForMulticast(message);
    console.log(`✅ FCM result: success=${resp.successCount}, failure=${resp.failureCount}`);

    const invalidTokens = [];
    const invalidCodes = new Set([
      'messaging/registration-token-not-registered',
      'messaging/invalid-argument',
      'messaging/invalid-registration-token',
    ]);

    resp.responses.forEach((r, idx) => {
      if (!r.success && r.error && invalidCodes.has(r.error.code)) {
        invalidTokens.push(tokens[idx]);
      }
    });

    if (invalidTokens.length) {
      await pool.query(
        `UPDATE seg_employee_details SET fcm_token = NULL WHERE fcm_token = ANY($1)`,
        [invalidTokens]
      );
      console.log('🗑 Cleared invalid tokens from DB:', invalidTokens.length);
    }

    return { successCount: resp.successCount, failureCount: resp.failureCount, invalidTokens };

  } catch (err) {
    console.error('❌ Error sending multicast:', err);
    return { successCount: 0, failureCount: 0, invalidTokens: [] };
  }
}

function shortRange(from_date, to_date) {
  if (!from_date && !to_date) return '';
  if (from_date && !to_date) return ` (${from_date})`;
  if (!from_date && to_date) return ` (till ${to_date})`;
  return ` (${from_date} → ${to_date})`;
}

// Routes
app.post('/api/save-fcm-token', async (req, res) => {
  const { empId, fcmToken } = req.body;

  if (!empId || !fcmToken) {
    return res.status(400).json({ error: 'empId and fcmToken are required' });
  }

  try {
    await pool.query(
      `UPDATE seg_employee_details SET fcm_token = $1 WHERE emp_id = $2`,
      [fcmToken, empId]
    );
    res.json({ success: true, message: 'Token saved successfully' });
  } catch (err) {
    console.error('Error saving FCM token:', err);
    res.status(500).json({ error: 'Failed to save token' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(400).json({ error: 'Empty body received' });
  }

  const { empId, password, fcm_token } = req.body;

  if (!empId || !password) {
    return res.status(400).json({ error: 'empId and password are required' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT 
         e.id, 
         e.emp_id, 
         e.emp_name, 
         e.designation, 
         e.password,
         e.role_id,
         e.fcm_token,
         f.name AS fla,
         s.name AS sla
       FROM seg_employee_details e
       LEFT JOIN fla_master f ON e.fla = f.id
       LEFT JOIN sla_master s ON e.sla = s.id
       WHERE e.emp_id = $1
       LIMIT 1`,
      [empId]
    );

    if (!rows.length) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (fcm_token && fcm_token.trim() !== '') {
      await pool.query(
        `UPDATE seg_employee_details 
         SET fcm_token = $1 
         WHERE emp_id = $2`,
        [fcm_token, empId]
      );
    }

    const token = jwt.sign(
      {
        sub: user.id,
        empId: user.emp_id,
        name: user.emp_name,
        designation: user.designation,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return res.json({
      token,
      user: {
        id: user.id,
        empId: user.emp_id,
        name: user.emp_name,
        designation: user.designation,
        role_id: user.role_id,
        fla: user.fla,
        sla: user.sla,
        fcmToken: fcm_token || user.fcm_token || null,
      },
    });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  console.log('Forgot password request body:', req.body);

  const { empId, newPassword } = req.body || {};

  if (!empId || !newPassword) {
    return res.status(400).json({ error: 'empId and newPassword are required' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters long' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id FROM seg_employee_details WHERE emp_id = $1 LIMIT 1`,
      [empId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }

    const hashed = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await pool.query(
      `UPDATE seg_employee_details SET password = $1 WHERE emp_id = $2`,
      [hashed, empId]
    );

    res.json({ message: 'Password reset successful' });
  } catch (e) {
    console.error('Forgot password error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/protected', (req, res) => {
  const auth = req.headers.authorization;

  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing token' });
  }

  const token = auth.split(' ')[1];

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    res.json({ message: 'Protected route accessed', user: payload });
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
});

app.get('/api/leave-types', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, leave_type FROM leave_master ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching leave types:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});
app.post('/api/leave-request', async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      employee_id,
      employee_name,
      fla,
      sla,
      leave_type,
      from_date,
      to_date,
      in_time,
      out_time,
      reason,
      remarks,
      request_type,
    } = req.body;

    console.log('📥 Incoming leave request for:', employee_id, employee_name);

    await client.query('BEGIN');

    const insertResult = await client.query(
      `INSERT INTO leave_request (
        employee_id, employee_name, fla, sla,
        leave_type, from_date, to_date, in_time, out_time,
        reason, remarks, request_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id, employee_id, employee_name, leave_type, from_date, to_date`,
      [
        employee_id,
        employee_name,
        fla,
        sla,
        leave_type,
        from_date,
        to_date,
        in_time,
        out_time,
        reason,
        remarks,
        request_type,
      ]
    );
    const lr = insertResult.rows[0];
    console.log('✅ Leave request saved with ID:', lr.id);

    await client.query('COMMIT');

    // Step 1: Get approvers
    const approvers = await getApproversForEmployee(employee_id);
    console.log('👀 Approvers fetched:', approvers);

    if (approvers) {
      const approverEmpIds = [...new Set([approvers.fla_emp_id, approvers.sla_emp_id].filter(Boolean))];
      console.log('👤 Approver Employee IDs:', approverEmpIds);

      // Step 2: Check FCM tokens for approvers
      const tokens = await getFcmTokensForEmpIds(approverEmpIds);
      console.log('📲 FCM Tokens for approvers:', tokens);

      if (tokens.length === 0) {
        console.warn('⚠️ No FCM tokens found — notification will not be sent.');
      }

      const title = 'New Leave Application';
      const body = `${employee_name} applied for ${leave_type}${shortRange(from_date, to_date)}`;
      const data = {
        type: 'LEAVE_APPLIED',
        leave_id: lr.id,
        applicant_emp_id: lr.employee_id,
      };

      // Step 3: Send notification
      const sendRes = await sendMulticastToEmpIds(approverEmpIds, { title, body }, data);
      console.log('📤 Notification send result:', sendRes);

      if (sendRes.successCount > 0) {
        console.log('🎯 Notification sent successfully!');
      } else {
        console.warn('❌ Notification failed to send.');
      }
    } else {
      console.warn('⚠️ No approvers found for employee:', employee_id);
    }

    res.status(201).json({ message: 'Leave request submitted', data: lr });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (e) {}
    console.error('💥 Error saving leave request:', err && err.message ? err.message : err);
    res.status(500).json({ error: 'Internal Server Error' });
  } finally {
    client.release();
  }
});


app.get('/api/leave-request/:employee_id', async (req, res) => {
  const { employee_id } = req.params;

  try {
    const result = await pool.query(
      `SELECT * FROM leave_request WHERE employee_id = $1 ORDER BY created_at DESC`,
      [employee_id]
    );

    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching leave requests:', error.message);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

app.get('/api/incoming-leaves', async (req, res) => {
  try {
    const approverEmpId = (req.user && req.user.emp_id) || String(req.query.empId || '').trim();

    if (!approverEmpId) {
      return res.status(400).json({ error: 'Approver empId is required' });
    }

    const sql = `
      SELECT
        lr.id                AS leave_id,
        lr.employee_id       AS applicant_emp_id,
        lr.employee_name     AS applicant_name,
        lr.leave_type,
        lr.from_date,
        lr.to_date,
        lr.status,
        fm.emp_id            AS fla_emp_id,
        fm.name              AS fla_name,
        sm.emp_id            AS sla_emp_id,
        sm.name              AS sla_name,
        (fm.emp_id = sm.emp_id) AS is_same_approver,
        lr.reason,
        lr.remarks
      FROM leave_request lr
      JOIN seg_employee_details sd ON lr.employee_id = sd.emp_id
      JOIN fla_master fm ON sd.fla = fm.id
      JOIN sla_master sm ON sd.sla = sm.id
      WHERE fm.emp_id = $1 OR sm.emp_id = $1
      ORDER BY lr.from_date DESC;
    `;

    const { rows } = await pool.query(sql, [approverEmpId]);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching incoming leaves:', err);
    res.status(500).json({ error: 'Database query error' });
  }
});

app.put('/api/leave-requests/:id/recommend', async (req, res) => {
  const { id } = req.params;
  const { empId } = req.body;

  try {
    const { rows } = await pool.query(
      `
      SELECT fla_emp_id, sla_emp_id, status 
      FROM (
        SELECT fm.emp_id AS fla_emp_id, sm.emp_id AS sla_emp_id, lr.status
        FROM leave_request lr
        JOIN seg_employee_details sd ON lr.employee_id = sd.emp_id
        JOIN fla_master fm ON sd.fla = fm.id
        JOIN sla_master sm ON sd.sla = sm.id
        WHERE lr.id = $1
      ) t
    `,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Leave not found' });
    }

    const leave = rows[0];

    if (leave.fla_emp_id !== empId) {
      return res.status(403).json({ error: 'You are not the FLA for this leave' });
    }

    if (leave.fla_emp_id === leave.sla_emp_id) {
      return res.status(400).json({ error: 'FLA and SLA are the same person. Use approve or reject instead.' });
    }

    await pool.query(
      `
      UPDATE leave_request
      SET status = 'FLA Recommended', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `,
      [id]
    );

    res.json({ message: 'Leave status updated to FLA Recommended' });
  } catch (err) {
    console.error('Recommend API error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/leave-requests/:id/not-recommend', async (req, res) => {
  const { id } = req.params;
  const { empId, reason } = req.body;

  if (!reason) {
    return res.status(400).json({ error: 'Reason is required for not recommending' });
  }

  try {
    const { rows } = await pool.query(
      `
      SELECT fla_emp_id, sla_emp_id, status 
      FROM (
        SELECT fm.emp_id AS fla_emp_id, sm.emp_id AS sla_emp_id, lr.status
        FROM leave_request lr
        JOIN seg_employee_details sd ON lr.employee_id = sd.emp_id
        JOIN fla_master fm ON sd.fla = fm.id
        JOIN sla_master sm ON sd.sla = sm.id
        WHERE lr.id = $1
      ) t
    `,
      [id]
    );

    if (!rows.length) return res.status(404).json({ error: 'Leave not found' });
    const leave = rows[0];

    if (leave.fla_emp_id === leave.sla_emp_id) {
      return res.status(400).json({ error: 'FLA and SLA are the same person. Use approve or reject instead.' });
    }

    if (leave.status.toLowerCase() !== 'pending') {
      return res.status(400).json({ error: 'Leave already processed by FLA' });
    }

    if (leave.fla_emp_id !== empId) {
      return res.status(403).json({ error: 'You are not the FLA for this leave' });
    }

    await pool.query(
      `
      UPDATE leave_request
      SET status = 'FLA Not Recommended', remarks = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `,
      [reason, id]
    );

    res.json({ message: 'Leave not recommended successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/leave-requests/:id/approve', async (req, res) => {
  const { id } = req.params;
  const { empId } = req.body;

  try {
    const { rows } = await pool.query(
      `
      SELECT fla_emp_id, sla_emp_id, status 
      FROM (
        SELECT fm.emp_id AS fla_emp_id, sm.emp_id AS sla_emp_id, lr.status
        FROM leave_request lr
        JOIN seg_employee_details sd ON lr.employee_id = sd.emp_id
        JOIN fla_master fm ON sd.fla = fm.id
        JOIN sla_master sm ON sd.sla = sm.id
        WHERE lr.id = $1
      ) t
    `,
      [id]
    );

    if (!rows.length) return res.status(404).json({ error: 'Leave not found' });
    const leave = rows[0];

    const isSameApprover = leave.fla_emp_id === leave.sla_emp_id;

    if (leave.sla_emp_id !== empId) {
      return res.status(403).json({ error: 'You are not the SLA for this leave' });
    }

    if (isSameApprover) {
      if (leave.status.toLowerCase() !== 'pending') {
        return res.status(400).json({ error: 'Leave already processed' });
      }
    } else {
      if (leave.status.toLowerCase() !== 'fla recommended' && leave.status.toLowerCase() !== 'fla not recommended') {
        return res.status(400).json({ error: 'Leave must be processed by FLA first' });
      }
    }

    await pool.query(
      `
      UPDATE leave_request
      SET status = 'Approved', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `,
      [id]
    );

    res.json({ message: 'Leave approved successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/leave-requests/:id/reject', async (req, res) => {
  const { id } = req.params;
  const { empId, reason } = req.body;

  if (!reason) {
    return res.status(400).json({ error: 'Reason is required for rejection' });
  }

  try {
    const { rows } = await pool.query(
      `
      SELECT fla_emp_id, sla_emp_id, status 
      FROM (
        SELECT fm.emp_id AS fla_emp_id, sm.emp_id AS sla_emp_id, lr.status
        FROM leave_request lr
        JOIN seg_employee_details sd ON lr.employee_id = sd.emp_id
        JOIN fla_master fm ON sd.fla = fm.id
        JOIN sla_master sm ON sd.sla = sm.id
        WHERE lr.id = $1
      ) t
    `,
      [id]
    );

    if (!rows.length) return res.status(404).json({ error: 'Leave not found' });
    const leave = rows[0];

    const isSameApprover = leave.fla_emp_id === leave.sla_emp_id;

    if (leave.sla_emp_id !== empId) {
      return res.status(403).json({ error: 'You are not the SLA for this leave' });
    }

    if (isSameApprover) {
      if (leave.status.toLowerCase() !== 'pending') {
        return res.status(400).json({ error: 'Leave already processed' });
      }
    } else {
      if (leave.status.toLowerCase() !== 'fla recommended' && leave.status.toLowerCase() !== 'fla not recommended') {
        return res.status(400).json({ error: 'Leave must be processed by FLA first' });
      }
    }

    await pool.query(
      `
      UPDATE leave_request
      SET status = 'Rejected', remarks = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `,
      [reason, id]
    );

    res.json({ message: 'Leave rejected successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/leave-counts/:empId', async (req, res) => {
  const empId = (req.user?.emp_id || req.params.empId || '').trim();

  if (!empId) {
    return res.status(400).json({ error: 'empId is required' });
  }

  console.log('🔍 Received empId:', empId);

  try {
    const approvedResult = await pool.query(
      `SELECT COUNT(*) AS count 
       FROM leave_request 
       WHERE employee_id = $1 AND status = 'Approved'`,
      [empId]
    );

    const rejectedResult = await pool.query(
      `SELECT COUNT(*) AS count 
       FROM leave_request 
       WHERE employee_id = $1 AND status = 'Rejected'`,
      [empId]
    );

    res.json({
      approved: Number(approvedResult.rows[0].count) || 0,
      rejected: Number(rejectedResult.rows[0].count) || 0,
    });
  } catch (err) {
    console.error('❌ Error fetching leave counts:', err);
    res.status(500).json({ error: 'Failed to fetch leave counts' });
  }
});

app.get('/api/leave-requests', async (req, res) => {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT * FROM leave_request ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('💥 Error fetching leave requests:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  } finally {
    client.release();
  }
});

// Global error-handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(PORT, HOST, () => {
  console.log(`🚀 Server running at http://${HOST}:${PORT}`);
});