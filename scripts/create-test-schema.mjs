import { createConnection } from 'mysql2/promise';
import { readConfig } from '../backend/src/config.mjs';
const config = readConfig();
if (config.mode !== 'test' || !/_test$/.test(config.db.database || '') || !process.argv.includes('--confirm-empty-test-db')) throw new Error('仅允许 APP_MODE=test、库名以 _test 结尾，且显式确认 --confirm-empty-test-db');
const { connectionLimit, ...options } = config.db;
const connection = await createConnection(options);
try {
  const [existing] = await connection.query('SHOW TABLES');
  if (existing.length) throw new Error('测试库不是空库，拒绝创建或覆盖任何表');
  const suffix = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci';
  const statements = [
    `CREATE TABLE users (id INT AUTO_INCREMENT PRIMARY KEY,username VARCHAR(50) NOT NULL,role VARCHAR(20) NOT NULL DEFAULT 'student',class_code VARCHAR(20),tokens INT DEFAULT 0) ${suffix}`,
    `CREATE TABLE classes (id INT AUTO_INCREMENT PRIMARY KEY,name VARCHAR(100) NOT NULL,class_code VARCHAR(10) UNIQUE NOT NULL,teacher_user_id INT NOT NULL,FOREIGN KEY(teacher_user_id) REFERENCES users(id)) ${suffix}`,
    `CREATE TABLE project_groups (id INT AUTO_INCREMENT PRIMARY KEY,user_id INT NOT NULL,name VARCHAR(100) NOT NULL,parent_id INT,sort_order INT DEFAULT 0,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,FOREIGN KEY(user_id) REFERENCES users(id),FOREIGN KEY(parent_id) REFERENCES project_groups(id) ON DELETE CASCADE) ${suffix}`,
    `CREATE TABLE projects (id VARCHAR(36) PRIMARY KEY,user_id INT NOT NULL,name VARCHAR(100) NOT NULL,parent_id INT,sort_order INT DEFAULT 0,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,FOREIGN KEY(user_id) REFERENCES users(id),FOREIGN KEY(parent_id) REFERENCES project_groups(id) ON DELETE SET NULL) ${suffix}`,
    `CREATE TABLE files (id INT AUTO_INCREMENT PRIMARY KEY,project_id VARCHAR(36) NOT NULL,name VARCHAR(100) NOT NULL,path VARCHAR(255) NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,UNIQUE KEY(project_id,path),FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE) ${suffix}`,
    "INSERT INTO users(id,username,role,class_code) VALUES (1,'测试教师','teacher',NULL),(2,'测试学生甲','student','CPPTEST'),(3,'测试学生乙','student','CPPTEST')",
    "INSERT INTO classes(id,name,class_code,teacher_user_id) VALUES (1,'独立测试班','CPPTEST',1)"
  ];
  for (const sql of statements) await connection.query(sql);
  console.log('已创建仅含虚拟账号的测试结构，不含密码和真实个人资料。下一步运行数据库迁移。');
} finally { await connection.end(); }
