const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const { initDatabase, getDb } = require('./database');

const app = express();
const PORT = 9008;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// API: 添加步数记录
app.post('/api/steps', (req, res) => {
  const { user_id, steps, record_time } = req.body;
  
  if (!user_id || steps === undefined) {
    return res.status(400).json({ error: '缺少必要参数：user_id 和 steps' });
  }

  const time = record_time || new Date().toISOString();
  const db = getDb();
  
  db.run(
    'INSERT INTO step_records (user_id, steps, record_time) VALUES (?, ?, ?)',
    [user_id, steps, time],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ id: this.lastID, user_id, steps, record_time: time });
    }
  );
});

// API: 更新步数记录
app.put('/api/steps/:id', (req, res) => {
  const { id } = req.params;
  const { user_id, steps, record_time } = req.body;
  
  if (!user_id || steps === undefined) {
    return res.status(400).json({ error: '缺少必要参数：user_id 和 steps' });
  }

  const db = getDb();
  
  db.run(
    'UPDATE step_records SET user_id = ?, steps = ?, record_time = ? WHERE id = ?',
    [user_id, steps, record_time, id],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: '记录不存在' });
      }
      res.json({ success: true, id: parseInt(id), user_id, steps, record_time });
    }
  );
});

// API: 获取每天步数
app.get('/api/steps/daily', (req, res) => {
  const { user_id, month } = req.query;

  if (!user_id) {
    return res.status(400).json({ error: '缺少 user_id 参数' });
  }

  let startDate, endDate;
  if (month) {
    startDate = `${month}-01 00:00:00`;
    const [year, m] = month.split('-');
    const lastDay = new Date(year, parseInt(m), 0).getDate();
    endDate = `${month}-${String(lastDay).padStart(2, '0')} 23:59:59`;
  } else {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    startDate = `${year}-${month}-01 00:00:00`;
    const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
    endDate = `${year}-${month}-${String(lastDay).padStart(2, '0')} 23:59:59`;
  }

  const db = getDb();

  // 获取用户步幅
  db.get('SELECT stride_length FROM user_settings WHERE user_id = ?', [user_id], (err, setting) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    const strideLength = setting ? setting.stride_length : 0.7;

    db.all(`
      SELECT
        strftime('%Y-%m-%d', record_time) as date,
        SUM(steps) as total_steps,
        COUNT(*) as record_count
      FROM step_records
      WHERE user_id = ? AND record_time BETWEEN ? AND ?
      GROUP BY strftime('%Y-%m-%d', record_time)
      ORDER BY date DESC
    `, [user_id, startDate, endDate], (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      // 添加距离信息（公里）
      const result = rows.map(row => ({
        ...row,
        distance_km: ((row.total_steps * strideLength) / 1000).toFixed(2)
      }));
      res.json(result);
    });
  });
});

// API: 获取每月步数
app.get('/api/steps/monthly', (req, res) => {
  const { user_id, year } = req.query;

  if (!user_id) {
    return res.status(400).json({ error: '缺少 user_id 参数' });
  }

  let startDate, endDate;
  if (year) {
    startDate = `${year}-01-01 00:00:00`;
    endDate = `${year}-12-31 23:59:59`;
  } else {
    const now = new Date();
    startDate = `${now.getFullYear()}-01-01 00:00:00`;
    endDate = `${now.getFullYear()}-12-31 23:59:59`;
  }

  const db = getDb();

  // 获取用户步幅
  db.get('SELECT stride_length FROM user_settings WHERE user_id = ?', [user_id], (err, setting) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    const strideLength = setting ? setting.stride_length : 0.7;

    db.all(`
      SELECT
        strftime('%Y-%m', record_time) as month,
        SUM(steps) as total_steps,
        COUNT(*) as record_count
      FROM step_records
      WHERE user_id = ? AND record_time BETWEEN ? AND ?
      GROUP BY strftime('%Y-%m', record_time)
      ORDER BY month DESC
    `, [user_id, startDate, endDate], (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      // 添加距离信息（公里）
      const result = rows.map(row => ({
        ...row,
        distance_km: ((row.total_steps * strideLength) / 1000).toFixed(2)
      }));
      res.json(result);
    });
  });
});

// API: 获取所有记录（支持分页）
app.get('/api/steps', (req, res) => {
  const { user_id, limit = 20, offset = 0 } = req.query;

  const db = getDb();
  let sql, params, countSql, countParams;

  if (user_id) {
    sql = 'SELECT * FROM step_records WHERE user_id = ? ORDER BY record_time DESC LIMIT ? OFFSET ?';
    params = [user_id, parseInt(limit), parseInt(offset)];
    countSql = 'SELECT COUNT(*) as total FROM step_records WHERE user_id = ?';
    countParams = [user_id];
  } else {
    sql = 'SELECT * FROM step_records ORDER BY record_time DESC LIMIT ? OFFSET ?';
    params = [parseInt(limit), parseInt(offset)];
    countSql = 'SELECT COUNT(*) as total FROM step_records';
    countParams = [];
  }

  db.get(countSql, countParams, (err, countResult) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    db.all(sql, params, (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({
        data: rows,
        total: countResult.total,
        limit: parseInt(limit),
        offset: parseInt(offset)
      });
    });
  });
});

// API: 删除记录
app.delete('/api/steps/:id', (req, res) => {
  const { id } = req.params;
  const db = getDb();

  db.run('DELETE FROM step_records WHERE id = ?', [id], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: '记录不存在' });
    }
    res.json({ success: true, message: '记录已删除' });
  });
});

// API: 获取用户设置
app.get('/api/settings/:user_id', (req, res) => {
  const { user_id } = req.params;
  const db = getDb();

  db.get('SELECT * FROM user_settings WHERE user_id = ?', [user_id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (row) {
      res.json(row);
    } else {
      // 默认步幅 0.7 米
      res.json({ user_id, stride_length: 0.7 });
    }
  });
});

// API: 更新用户设置
app.put('/api/settings/:user_id', (req, res) => {
  const { user_id } = req.params;
  const { stride_length } = req.body;

  if (stride_length === undefined || stride_length <= 0) {
    return res.status(400).json({ error: '步幅必须大于 0' });
  }

  const db = getDb();

  db.run(
    'INSERT OR REPLACE INTO user_settings (user_id, stride_length) VALUES (?, ?)',
    [user_id, stride_length],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ success: true, user_id, stride_length });
    }
  );
});

// 首页
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function start() {
  await initDatabase();
  app.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
  });
}

start();
