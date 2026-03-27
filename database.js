const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'run_records.db');

let db = null;

function initDatabase() {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        reject(err);
        return;
      }
      console.log('SQLite 数据库已连接');
      
      // 创建表
      db.run(`
        CREATE TABLE IF NOT EXISTS step_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          steps INTEGER NOT NULL,
          hour INTEGER,
          record_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) reject(err);
        else {
          console.log('数据表初始化完成');

          // 添加小时字段（兼容旧数据）
          db.run(`
            ALTER TABLE step_records ADD COLUMN hour INTEGER
          `, (err) => {
            // 忽略字段已存在的错误
            if (err && !err.message.includes('duplicate column')) {
              console.error('添加 hour 字段失败:', err);
            }
          });

          // 添加用户设置表
          db.run(`
            CREATE TABLE IF NOT EXISTS user_settings (
              user_id TEXT PRIMARY KEY,
              stride_length REAL DEFAULT 0.7,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
          `, (err) => {
            if (err) reject(err);
            else {
              console.log('用户设置表已创建');
              // 检查是否有 JSON 数据需要迁移
              migrateFromJSON();
              resolve(db);
            }
          });
        }
      });
    });
  });
}

function migrateFromJSON() {
  const jsonPath = path.join(__dirname, 'run_records.json');
  if (fs.existsSync(jsonPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      if (data.step_records && data.step_records.length > 0) {
        console.log(`发现 ${data.step_records.length} 条 JSON 数据，开始迁移...`);
        
        const stmt = db.prepare(`
          INSERT INTO step_records (id, user_id, steps, record_time, created_at)
          VALUES (?, ?, ?, ?, ?)
        `);
        
        db.serialize(() => {
          db.run('BEGIN TRANSACTION');
          
          data.step_records.forEach(record => {
            stmt.run(
              record.id,
              record.user_id,
              record.steps,
              record.record_time,
              record.created_at || record.record_time
            );
          });
          
          db.run('COMMIT', (err) => {
            if (err) {
              console.error('迁移失败:', err);
              db.run('ROLLBACK');
            } else {
              console.log('数据迁移完成！');
              // 备份 JSON 文件
              fs.renameSync(jsonPath, jsonPath + '.bak');
              console.log('原 JSON 文件已备份为 run_records.json.bak');
            }
          });
          
          stmt.finalize();
        });
      }
    } catch (err) {
      console.error('JSON 数据迁移失败:', err);
    }
  }
}

function getDb() {
  return db;
}

module.exports = { initDatabase, getDb };
