USE bonus_hr;

-- Q1 — current designation for every employee

SELECT emp_id, emp_name, designation AS current_designation
FROM (
  SELECT
    emp_id,
    emp_name,
    designation,
    ROW_NUMBER() OVER (
      PARTITION BY emp_id
      ORDER BY effective_date DESC, txn_id DESC
    ) AS rn
  FROM emp_designation_log
) AS ranked
WHERE rn = 1
ORDER BY emp_id;


-- Q2 — designation timeline: previous / current / next, for EVERY row

SELECT
  emp_id,
  effective_date,
  LAG(designation)  OVER w AS previous_designation,
  designation,
  LEAD(designation) OVER w AS next_designation
FROM emp_designation_log
WINDOW w AS (PARTITION BY emp_id ORDER BY effective_date, txn_id)
ORDER BY emp_id, effective_date, txn_id;


-- Q4 — the designation held on the day each allocation started

WITH employees AS (
  SELECT emp_id, MAX(emp_name) AS emp_name
  FROM emp_designation_log
  GROUP BY emp_id
)
SELECT
  a.allocation_id,
  a.emp_id,
  e.emp_name,
  a.project_name,
  a.allocated_role,
  a.allocation_start,
  (
    SELECT d.designation
    FROM emp_designation_log AS d
    WHERE d.emp_id = a.emp_id
      AND d.effective_date <= a.allocation_start
    ORDER BY d.effective_date DESC, d.txn_id DESC
    LIMIT 1
  ) AS designation_at_allocation
FROM emp_allocation_log AS a
LEFT JOIN employees AS e ON e.emp_id = a.emp_id
ORDER BY a.allocation_id;
