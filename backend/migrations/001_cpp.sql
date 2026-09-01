-- 本迁移只做兼容性新增。执行前备份，并先在独立测试库验证。
ALTER TABLE projects ADD COLUMN project_type VARCHAR(16) NOT NULL DEFAULT 'p5js';
ALTER TABLE project_groups ADD COLUMN project_type VARCHAR(16) NOT NULL DEFAULT 'p5js';
CREATE INDEX idx_projects_user_type_parent ON projects(user_id, project_type, parent_id, sort_order);
CREATE INDEX idx_groups_user_type_parent ON project_groups(user_id, project_type, parent_id, sort_order);

CREATE TABLE cpp_documents (
  project_id VARCHAR(36) NOT NULL PRIMARY KEY,
  revision_id CHAR(36) NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT fk_cpp_doc_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE cpp_revisions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  user_id INT NOT NULL,
  source_bytes INT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL,
  INDEX idx_cpp_revisions_user_time(user_id, created_at),
  CONSTRAINT fk_cpp_revision_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE cpp_runs (
  id CHAR(36) NOT NULL PRIMARY KEY,
  queue_order BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE,
  user_id INT NOT NULL,
  project_id VARCHAR(36) NOT NULL,
  revision_id CHAR(36) NOT NULL,
  version INT UNSIGNED NOT NULL,
  request_id CHAR(36) NOT NULL,
  state VARCHAR(24) NOT NULL,
  profile_json JSON NOT NULL,
  compiler_output MEDIUMTEXT NOT NULL,
  stdout MEDIUMTEXT NOT NULL,
  stderr MEDIUMTEXT NOT NULL,
  message VARCHAR(1000) NOT NULL DEFAULT '',
  elapsed_ms INT UNSIGNED DEFAULT NULL,
  memory_bytes BIGINT UNSIGNED DEFAULT NULL,
  result_bytes INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  finished_at DATETIME(3) DEFAULT NULL,
  UNIQUE KEY uk_cpp_request(user_id, request_id),
  INDEX idx_cpp_run_state_time(state, created_at),
  INDEX idx_cpp_run_user_time(user_id, created_at),
  CONSTRAINT fk_cpp_run_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE cpp_distributions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  teacher_user_id INT NOT NULL,
  source_project_id VARCHAR(36) NOT NULL,
  class_id INT NOT NULL,
  request_id CHAR(36) NOT NULL,
  recipients_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_cpp_distribution_request(teacher_user_id, request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE cpp_queue_guard (id TINYINT NOT NULL PRIMARY KEY) ENGINE=InnoDB;
INSERT INTO cpp_queue_guard(id) VALUES (1);
