-- Bonus section: schema and sample data exactly as given in the assessment.

-- Run against any MySQL 8 instance:

DROP DATABASE IF EXISTS bonus_hr;
CREATE DATABASE bonus_hr CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE bonus_hr;

CREATE TABLE emp_designation_log (
  txn_id         VARCHAR(10)  NOT NULL,
  emp_id         VARCHAR(10)  NOT NULL,
  emp_name       VARCHAR(100) NOT NULL,
  designation    VARCHAR(50)  NOT NULL,
  effective_date DATE         NOT NULL,
  PRIMARY KEY (txn_id)
);

CREATE TABLE emp_allocation_log (
  allocation_id    VARCHAR(10)  NOT NULL,
  emp_id           VARCHAR(10)  NOT NULL,
  project_name     VARCHAR(100) NOT NULL,
  allocated_role   VARCHAR(50)  NOT NULL,
  allocation_start DATE         NOT NULL,
  allocation_end   DATE         NULL,   -- NULL = still active
  PRIMARY KEY (allocation_id)
);

INSERT INTO emp_designation_log (txn_id, emp_id, emp_name, designation, effective_date) VALUES
  ('T001','EMP001','Alice Johnson','Associate Developer','2024-02-01'),
  ('T002','EMP001','Alice Johnson','Mid Developer',      '2024-02-05'),
  ('T003','EMP001','Alice Johnson','Senior Developer',   '2024-02-10'),
  ('T004','EMP002','Bob Martinez', 'Mid Developer',      '2024-05-02'),
  ('T005','EMP002','Bob Martinez', 'Senior Developer',   '2024-07-15'),
  ('T006','EMP002','Bob Martinez', 'Mid Developer',      '2024-09-20'),
  ('T007','EMP003','Carol Smith',  'Mid Developer',      '2024-08-06'),
  ('T008','EMP003','Carol Smith',  'Mid Developer',      '2024-08-06'),
  ('T009','EMP004','David Lee',    'Associate Developer','2024-01-10'),
  ('T010','EMP004','David Lee',    'Associate Developer','2024-04-10'),
  ('T011','EMP004','David Lee',    'Mid Developer',      '2024-09-10'),
  ('T012','EMP005','Eva Chen',     'Senior Developer',   '2024-06-15'),
  ('T013','EMP005','Eva Chen',     'Mid Developer',      '2024-03-01'),
  ('T014','EMP005','Eva Chen',     'Senior Developer',   '2024-11-20'),
  ('T015','EMP006','Frank Patel',  'Associate Developer','2024-01-01'),
  ('T016','EMP006','Frank Patel',  'Mid Developer',      '2024-05-10'),
  ('T017','EMP006','Frank Patel',  'Mid Developer',      '2024-05-10'),
  ('T018','EMP007','Grace Kim',    'Senior Developer',   '2023-03-03'),
  ('T019','EMP007','Grace Kim',    'Resigned',           '2023-06-30'),
  ('T020','EMP007','Grace Kim',    'Associate Developer','2024-01-15'),
  ('T021','EMP007','Grace Kim',    'Mid Developer',      '2024-07-15'),
  ('T022','EMP008','Henry Walsh',  'Associate Developer','2024-06-01'),
  ('T023','EMP008','Henry Walsh',  'Mid Developer',      '2024-06-01'),
  ('T024','EMP009','Irene Novak',  'Senior Developer',   '2024-09-01');

INSERT INTO emp_allocation_log (allocation_id, emp_id, project_name, allocated_role, allocation_start, allocation_end) VALUES
  ('A001','EMP001','Project Alpha','Developer',         '2024-02-03','2024-04-30'),
  ('A002','EMP001','Project Beta', 'Tech Lead',         '2024-05-01','2024-09-30'),
  ('A003','EMP002','Project Alpha','Developer',         '2024-05-10','2024-08-31'),
  ('A004','EMP002','Project Gamma','Senior Contributor','2024-09-01',NULL),
  ('A005','EMP003','Project Beta', 'Developer',         '2024-08-06','2024-12-31'),
  ('A006','EMP004','Project Delta','Developer',         '2024-02-01','2024-10-31'),
  ('A007','EMP005','Project Alpha','Senior Contributor','2024-04-01','2024-07-31'),
  ('A008','EMP005','Project Gamma','Tech Lead',         '2024-08-01',NULL),
  ('A009','EMP006','Project Delta','Developer',         '2024-03-01','2024-06-30'),
  ('A010','EMP007','Project Beta', 'Developer',         '2024-02-01','2024-06-30'),
  ('A011','EMP008','Project Alpha','Developer',         '2024-07-01',NULL),
  ('A012','EMP009','Project Gamma','Senior Contributor','2024-10-01',NULL);
