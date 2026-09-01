-- 仅供 verify-mysql.mjs 在指定的空测试库中使用；不读取、复制或修改正式业务数据。
-- 保留迁移及模型所需的 MySQL 类型、排序规则、索引和外键，账号均为虚拟账号。
CREATE TABLE users (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  role VARCHAR(20) NOT NULL DEFAULT 'student',
  class_code VARCHAR(20) DEFAULT NULL,
  tokens INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE classes (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  class_code VARCHAR(10) NOT NULL UNIQUE,
  teacher_user_id INT NOT NULL,
  FOREIGN KEY (teacher_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE project_groups (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  parent_id INT DEFAULT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_project_groups_user_parent (user_id,parent_id),
  CONSTRAINT fk_project_groups_parent FOREIGN KEY (parent_id) REFERENCES project_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_project_groups_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE projects (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  user_id INT NOT NULL,
  name VARCHAR(100) NOT NULL DEFAULT '未命名项目',
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  parent_id INT DEFAULT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  KEY idx_user_id (user_id),
  KEY idx_projects_user_parent (user_id,parent_id),
  CONSTRAINT fk_projects_parent_group FOREIGN KEY (parent_id) REFERENCES project_groups(id) ON DELETE SET NULL,
  CONSTRAINT fk_projects_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE files (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  name VARCHAR(100) NOT NULL,
  path VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_project_path (project_id,path),
  CONSTRAINT fk_files_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
INSERT INTO users(id,username,role,class_code) VALUES
  (1,'fixture-alice','student','A'),(2,'fixture-teacher-a','teacher',NULL),
  (3,'fixture-bob','student','B'),(4,'fixture-teacher-b','teacher',NULL),(5,'fixture-admin','admin',NULL);
INSERT INTO classes(id,name,class_code,teacher_user_id) VALUES (1,'Fixture A','A',2),(2,'Fixture B','B',4);
INSERT INTO project_groups(id,user_id,name,parent_id,sort_order) VALUES
  (11,1,'p-root',NULL,10),(12,1,'p-child',11,20),(13,1,'p-empty',NULL,30),(31,3,'other-p-root',NULL,50);
INSERT INTO projects(id,user_id,name,parent_id,sort_order) VALUES
  ('p-root',1,'p-root',NULL,10),('p-second',1,'p-second',NULL,20),
  ('p-child',1,'p-child',11,30),('p-grandchild',1,'p-grandchild',12,40),
  ('p-other',3,'p-other',NULL,60),('p-teacher',2,'p-teacher',NULL,70);
INSERT INTO files(id,project_id,name,path) VALUES
  (1,'p-root','index.html','./index.html'),(2,'p-root','folder','./folder'),
  (3,'p-root','a.js','./folder/a.js'),(6,'p-other','index.html','./index.html');
