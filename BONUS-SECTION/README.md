# Bonus Section

Answers to the bonus questions of the Event Planning Application assessment.

The assessment paper numbers these questions **Q1, Q2 and Q4**. It contains no
Q3. All three questions asked are answered here.

Every query in this document was executed against **MySQL 8.4.11**. Every result
set shown is captured output, not an expected result.

---

## 1. Contents

| File | Purpose |
|---|---|
| `01-schema-and-data.sql` | Table definitions and sample data, exactly as specified in the assessment |
| `02-answers.sql` | The three answer queries |
| `README.md` | This document |
| `BONUS-SECTION.pdf` | The same content in PDF form |

## 2. Reproduction

The application's existing MySQL container is sufficient. The bonus schema is
created in its own database, `bonus_hr`, and neither reads nor modifies any
application table.

```bash
npm run db:up     # MySQL 8.4 in Docker, as used by the application

docker exec -i -e MYSQL_PWD=rootpassword eventplanner-mysql \
  mysql -uroot < BONUS-SECTION/01-schema-and-data.sql

docker exec -i -e MYSQL_PWD=rootpassword eventplanner-mysql \
  mysql -uroot --table < BONUS-SECTION/02-answers.sql
```

`01-schema-and-data.sql` drops and recreates `bonus_hr`, so it may be re-run to
reset the data. It produces no output, consisting only of DDL and inserts.
`MYSQL_PWD` is used in place of `-p` to suppress the client's
password-on-command-line warning.

---

## 3. Properties of the sample data that determine correctness

Four properties of the supplied data decide whether a query is correct or merely
plausible. Each was established by querying the data.

### 3.1 The most recent `effective_date` does not identify a unique row

`EMP008` holds two different designations effective on the same date:

| txn_id | designation | effective_date |
|---|---|---|
| `T022` | Associate Developer | 2024-06-01 |
| `T023` | Mid Developer | 2024-06-01 |

`ORDER BY effective_date DESC` alone therefore does not identify a single row,
and a query selecting rows matching each employee's maximum `effective_date`
returns this employee twice. The result becomes whichever row the optimiser
reaches first, which may change with the MySQL version or the chosen plan.

Every query below applies `txn_id` as a tiebreak, on the reasoning that a higher
transaction identifier was recorded later and therefore represents the later
decision. This is a stated assumption rather than a guarantee of the schema; see
section 7.

Two further employees have same-date pairs, but with identical designations in
both rows, making them duplicates rather than ambiguities:

| emp_id | effective_date | rows | distinct designations |
|---|---|---|---|
| `EMP003` | 2024-08-06 | 2 | 1 |
| `EMP006` | 2024-05-10 | 2 | 1 |
| `EMP008` | 2024-06-01 | 2 | **2** |

Only `EMP008` requires a tiebreak to produce a determinate answer.

### 3.2 Rows are not stored in chronological order

`EMP005` contains one row whose `txn_id` sequence contradicts its
`effective_date` sequence:

| txn_id | designation | effective_date |
|---|---|---|
| `T012` | Senior Developer | 2024-06-15 |
| `T013` | Mid Developer | 2024-03-01 |
| `T014` | Senior Developer | 2024-11-20 |

Ordering by `txn_id`, or relying on physical insertion order, produces incorrect
results. The failure is not visible in Q1: this employee's current designation is
`Senior Developer` under either ordering, `T014` being both the highest `txn_id`
and the latest date. It appears in the other two answers — in Q2 as a timeline
reading Senior → Mid → Senior, and in Q4 as an incorrect designation for `A008`.

Ordering must therefore be driven by `effective_date`, with `txn_id` serving only
as a tiebreak within a single date.

### 3.3 Exact duplicate rows

`EMP003` and `EMP006` each contain two rows with identical designation and
identical date (`T007`/`T008` and `T016`/`T017`). These affect none of the three
answers. They appear in Q2 as steps in which the previous and current
designations are equal, and they would cause a `COUNT(*)`-based promotion count
to overstate.

### 3.4 `Resigned` is a designation value

`EMP007` resigned on 2023-06-30 and was rehired on 2024-01-15. `Resigned`
occupies the `designation` column like any other value. Two consequences follow:
this employee's current designation is `Mid Developer` rather than `Resigned`,
and a point-in-time query falling within the resignation period correctly returns
`Resigned`.

---

## 4. Q1 — Current designation for every employee

**Requirement.** Return the current designation of every employee, defined as the
designation from their most recent `effective_date`.

**Output columns.** `emp_id | emp_name | current_designation`

**Approach.** Rank each employee's rows newest-first and retain the top one. A
window function does this in a single pass, without the self-join the classic
formulation requires.

### Query

```sql
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
```

### Result

| emp_id | emp_name | current_designation |
|---|---|---|
| EMP001 | Alice Johnson | Senior Developer |
| EMP002 | Bob Martinez | Mid Developer |
| EMP003 | Carol Smith | Mid Developer |
| EMP004 | David Lee | Mid Developer |
| EMP005 | Eva Chen | Senior Developer |
| EMP006 | Frank Patel | Mid Developer |
| EMP007 | Grace Kim | Mid Developer |
| EMP008 | Henry Walsh | Mid Developer |
| EMP009 | Irene Novak | Senior Developer |

*9 rows.*

### Notes

**`ROW_NUMBER`, not `RANK`.** `RANK` assigns equal rank to tied rows. Applied to
`EMP008`, whose two designations share a date, it would return both rows and
report two current designations — reintroducing the ambiguity the tiebreak
resolves. `ROW_NUMBER` is a total ordering and breaks the tie through the second
`ORDER BY` term.

**The derived table is required.** Window functions are evaluated after `WHERE`,
so the `rn = 1` predicate cannot appear in the same `SELECT` that computes `rn`.

**Interpretation of results.** `EMP002` returns `Mid Developer`, not
`Senior Developer`: this employee was demoted on 2024-09-20, and "current" is
defined as most recent, not most senior. `EMP007` returns `Mid Developer`, not
`Resigned`, the rehire being the latest state.

### Alternative formulation without window functions

For environments predating MySQL 8.0, the same result is obtained by joining each
employee to their own maximum date. The tiebreak must then be applied twice,
which is the awkwardness `ROW_NUMBER` removes. Verified to return identical
results to the query above.

```sql
SELECT d.emp_id, d.emp_name, d.designation AS current_designation
FROM emp_designation_log AS d
JOIN (
  SELECT emp_id, MAX(effective_date) AS max_date
  FROM emp_designation_log
  GROUP BY emp_id
) AS latest
  ON latest.emp_id = d.emp_id
 AND latest.max_date = d.effective_date
WHERE d.txn_id = (
  SELECT MAX(d2.txn_id)
  FROM emp_designation_log AS d2
  WHERE d2.emp_id = d.emp_id AND d2.effective_date = d.effective_date
)
ORDER BY d.emp_id;
```

---

## 5. Q2 — Designation timeline

**Requirement.** For every row in the designation table, return the designation
held immediately before and immediately after that row for the same employee,
with `NULL` where no such row exists.

**Output columns.**
`emp_id | effective_date | previous_designation | designation | next_designation`

**Approach.** `LAG` and `LEAD` over a single partition.

### Query

```sql
SELECT
  emp_id,
  effective_date,
  LAG(designation)  OVER w AS previous_designation,
  designation,
  LEAD(designation) OVER w AS next_designation
FROM emp_designation_log
WINDOW w AS (PARTITION BY emp_id ORDER BY effective_date, txn_id)
ORDER BY emp_id, effective_date, txn_id;
```

### Result

| emp_id | effective_date | previous_designation | designation | next_designation |
|---|---|---|---|---|
| EMP001 | 2024-02-01 | NULL | Associate Developer | Mid Developer |
| EMP001 | 2024-02-05 | Associate Developer | Mid Developer | Senior Developer |
| EMP001 | 2024-02-10 | Mid Developer | Senior Developer | NULL |
| EMP002 | 2024-05-02 | NULL | Mid Developer | Senior Developer |
| EMP002 | 2024-07-15 | Mid Developer | Senior Developer | Mid Developer |
| EMP002 | 2024-09-20 | Senior Developer | Mid Developer | NULL |
| EMP003 | 2024-08-06 | NULL | Mid Developer | Mid Developer |
| EMP003 | 2024-08-06 | Mid Developer | Mid Developer | NULL |
| EMP004 | 2024-01-10 | NULL | Associate Developer | Associate Developer |
| EMP004 | 2024-04-10 | Associate Developer | Associate Developer | Mid Developer |
| EMP004 | 2024-09-10 | Associate Developer | Mid Developer | NULL |
| EMP005 | 2024-03-01 | NULL | Mid Developer | Senior Developer |
| EMP005 | 2024-06-15 | Mid Developer | Senior Developer | Senior Developer |
| EMP005 | 2024-11-20 | Senior Developer | Senior Developer | NULL |
| EMP006 | 2024-01-01 | NULL | Associate Developer | Mid Developer |
| EMP006 | 2024-05-10 | Associate Developer | Mid Developer | Mid Developer |
| EMP006 | 2024-05-10 | Mid Developer | Mid Developer | NULL |
| EMP007 | 2023-03-03 | NULL | Senior Developer | Resigned |
| EMP007 | 2023-06-30 | Senior Developer | Resigned | Associate Developer |
| EMP007 | 2024-01-15 | Resigned | Associate Developer | Mid Developer |
| EMP007 | 2024-07-15 | Associate Developer | Mid Developer | NULL |
| EMP008 | 2024-06-01 | NULL | Associate Developer | Mid Developer |
| EMP008 | 2024-06-01 | Associate Developer | Mid Developer | NULL |
| EMP009 | 2024-09-01 | NULL | Senior Developer | NULL |

*24 rows, one per input row.*

### Notes

**A single named window.** `LAG` and `LEAD` must operate over an identical
ordering. If the two orderings differ, a row's `next_designation` ceases to match
the following row's `designation`, producing a result set that is internally
inconsistent while returning the correct number of rows. Declaring the window
once in a `WINDOW` clause makes divergence structurally impossible; two inline
`OVER (...)` clauses can be modified independently without error.

**Ascending order.** The window is ordered ascending, in contrast to Q1's
descending order, because a timeline is read forwards.

**Partition boundaries.** `LAG` and `LEAD` return `NULL` at the first and last
row of each partition with no special handling, which is what the question
requires.

**Interpretation of results.** `EMP005` is returned in date order (2024-03-01
first) despite its storage order. `EMP003` and `EMP006` produce steps in which
the previous and current designations are equal, which is the correct rendering
of duplicate rows.

### Variant: transitions only

If the requirement is a promotion history rather than a transaction history, the
no-change rows can be removed. This requires **two window passes, not one pass
followed by a filter.** Filtering the completed result set removes rows without
recomputing `LAG` and `LEAD` on the rows that remain: removing `EMP004`'s
2024-04-10 row leaves the preceding row asserting
`next_designation = Associate Developer`, while the next row actually displayed
is `Mid Developer`. A `WHERE` clause at the outer level is in any case rejected,
window functions being evaluated after `WHERE`.

MySQL does not implement `IS DISTINCT FROM`; the null-safe equality operator
`<=>` expresses both the comparison and the retention of each employee's first
row in one predicate.

```sql
WITH marked AS (
  SELECT
    txn_id, emp_id, designation, effective_date,
    LAG(designation) OVER (
      PARTITION BY emp_id ORDER BY effective_date, txn_id
    ) AS prev_raw
  FROM emp_designation_log
),
changes_only AS (
  SELECT txn_id, emp_id, designation, effective_date
  FROM marked
  WHERE NOT (prev_raw <=> designation)   -- null-safe: keeps each employee's first row
)
SELECT
  emp_id,
  effective_date,
  LAG(designation)  OVER w AS previous_designation,
  designation,
  LEAD(designation) OVER w AS next_designation
FROM changes_only
WINDOW w AS (PARTITION BY emp_id ORDER BY effective_date, txn_id)
ORDER BY emp_id, effective_date, txn_id;
```

Verified: this removes `T008`, `T010`, `T014` and `T017`, returning 20 rows.
`T010` is removed although its date differs from the preceding row — a repeated
designation is a non-transition whether or not the date repeats. Selection
between the two forms is a product decision; the query in section 5 answers the
question as specified, which is every row.

---

## 6. Q4 — Designation held at the time of each allocation

**Requirement.** For each project allocation, return the designation the employee
held on the allocation start date.

**Output columns.**
`allocation_id | emp_id | emp_name | project_name | allocated_role | allocation_start | designation_at_allocation`

### 6.1 Derivation

The designation table records only the date on which a designation began. No end
date is stored, so each designation's validity interval is implicit: it extends
from its `effective_date` until the next row for that employee, and the final row
is open-ended.

Two formulations follow.

1. **Backward point lookup.** For each allocation, select the employee's latest
   designation row whose `effective_date` is on or before `allocation_start`. One
   input row yields at most one output row.
2. **Interval construction.** Derive each designation's end date with `LEAD`, then
   range-join each allocation into the interval containing its start date.

Both are correct. Formulation 1 is used as the primary answer: it states the
requirement directly, and it reduces to an indexed backward range scan
terminating at the first qualifying row. Formulation 2 is preferable where the
intervals are required for other reporting, and is given in section 6.5.

Formulation 1 is expressed as a correlated scalar subquery rather than
`LEFT JOIN LATERAL`. Only one column is required from the lookup, and a scalar
subquery evaluates to `NULL` when no row qualifies, satisfying the
unresolved-lookup requirement without an outer join. `LATERAL` becomes the
preferable construct when more than one column must be returned.

### 6.2 The three stated considerations

The assessment identifies three points to address. Each is handled explicitly.

**An employee may have held multiple designations; only one was active on
`allocation_start`.** The subquery orders by `effective_date DESC, txn_id DESC`
and applies `LIMIT 1`, selecting exactly the latest designation in force on that
date. The `txn_id` term resolves the same-date ambiguity of section 3.1.

**The designation table stores no end date.** No end date is derived. The
predicate `effective_date <= allocation_start`, combined with descending order
and `LIMIT 1`, locates the applicable row without materialising intervals. The
comparison is inclusive: a designation effective 2024-08-06 is in force for an
allocation beginning 2024-08-06. This case occurs in the sample data as `A005`.

**An employee may have no designation record before `allocation_start`.** The
allocation is retained and `designation_at_allocation` is `NULL`. Section 6.4
documents the behaviour.

### 6.3 Query

```sql
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
```

**Resolution of `emp_name`.** The allocation table does not carry the employee
name; it is denormalised onto every designation row. Reading it from the
point-in-time lookup would return `NULL` for the name on precisely those rows
where the designation is unresolved, discarding information present elsewhere in
the same table. The `employees` common table expression resolves the name
independently, so the two lookups fail independently. An unresolved designation
and an unrecognised employee are distinct conditions of differing severity, and
the report distinguishes them.

`MAX(emp_name)` selects one name per employee. This is sound under assumption 5
of section 7, and would conceal rather than surface a disagreement between rows.

### Result

| allocation_id | emp_id | emp_name | project_name | allocated_role | allocation_start | designation_at_allocation |
|---|---|---|---|---|---|---|
| A001 | EMP001 | Alice Johnson | Project Alpha | Developer | 2024-02-03 | Associate Developer |
| A002 | EMP001 | Alice Johnson | Project Beta | Tech Lead | 2024-05-01 | Senior Developer |
| A003 | EMP002 | Bob Martinez | Project Alpha | Developer | 2024-05-10 | Mid Developer |
| A004 | EMP002 | Bob Martinez | Project Gamma | Senior Contributor | 2024-09-01 | Senior Developer |
| A005 | EMP003 | Carol Smith | Project Beta | Developer | 2024-08-06 | Mid Developer |
| A006 | EMP004 | David Lee | Project Delta | Developer | 2024-02-01 | Associate Developer |
| A007 | EMP005 | Eva Chen | Project Alpha | Senior Contributor | 2024-04-01 | Mid Developer |
| A008 | EMP005 | Eva Chen | Project Gamma | Tech Lead | 2024-08-01 | Senior Developer |
| A009 | EMP006 | Frank Patel | Project Delta | Developer | 2024-03-01 | Associate Developer |
| A010 | EMP007 | Grace Kim | Project Beta | Developer | 2024-02-01 | Associate Developer |
| A011 | EMP008 | Henry Walsh | Project Alpha | Developer | 2024-07-01 | Mid Developer |
| A012 | EMP009 | Irene Novak | Project Gamma | Senior Contributor | 2024-10-01 | Senior Developer |

*12 rows.*

`A001` returns `Associate Developer`, matching the worked example given in the
assessment: the allocation began on 2024-02-03 and the employee became
`Mid Developer` on 2024-02-05.

Three rows depend on decisions taken above:

| Row | Value | Dependency |
|---|---|---|
| `A004` | `Senior Developer` | Point-in-time lookup rather than current designation. Taking the employee's current designation returns `Mid Developer`, the demotion occurring 19 days after the allocation start |
| `A008` | `Senior Developer` | Ordering by `effective_date` rather than `txn_id`. Ordering by `txn_id` returns `Mid Developer` (section 3.2) |
| `A011` | `Mid Developer` | The `txn_id` tiebreak. Without it the result is non-deterministic, two designations sharing 2024-06-01 (section 3.1) |

### 6.4 Employees with no designation before `allocation_start`

The condition does not occur in the sample data. No allocation `emp_id` is absent
from the designation log, and no allocation begins before its employee's first
designation. The branch is therefore unexercised by the supplied data, and was
verified by inserting two allocations that force it: one for an employee absent
from the designation log entirely, and one predating the employee's first
designation.

| allocation_id | emp_id | emp_name | allocation_start | designation_at_allocation |
|---|---|---|---|---|
| `A998` | `EMP001` | Alice Johnson | 2024-01-01 | NULL |
| `A999` | `EMP010` | NULL | 2024-05-01 | NULL |

Both allocations are retained. `A998` resolves its employee name, the employee
being present in the designation log; the employee simply held no designation on
2024-01-01. `A999` does not, the employee appearing nowhere in the designation
log, leaving the name unrecoverable from these two tables. This distinction is
the purpose of resolving the name through a separate join.

`NULL` is returned rather than a substitute string such as `'Unknown'`. `NULL`
denotes absence, whereas a string value denotes a designation of that name and
would be counted as one by any downstream aggregation. Presentation of the absent
value belongs to the reporting layer.

A non-empty result from this branch should be treated as a data-quality
exception: an allocation without a preceding designation indicates either a
missing designation record or an allocation recorded against an incorrect
`emp_id`.

A related case requires no special handling. Because `Resigned` is a designation
value, an allocation beginning during a resignation resolves to it. `EMP007`'s
actual allocation (`A010`, 2024-02-01) begins after the 2024-01-15 rehire and
correctly returns `Associate Developer`; an allocation beginning 2023-09-01 would
return `Resigned`, which is the accurate answer and a contradiction the report
should expose rather than conceal.

### 6.5 Alternative formulation: validity intervals

Applicable where designation intervals are required for other reporting.
Verified to return identical results to the query in section 6.3.

```sql
WITH employees AS (
  SELECT emp_id, MAX(emp_name) AS emp_name
  FROM emp_designation_log
  GROUP BY emp_id
),
designation_spans AS (
  SELECT
    emp_id,
    designation,
    effective_date AS valid_from,
    LEAD(effective_date) OVER (
      PARTITION BY emp_id ORDER BY effective_date, txn_id
    ) AS valid_until          -- NULL on the final row: open-ended
  FROM emp_designation_log
)
SELECT
  a.allocation_id, a.emp_id, e.emp_name, a.project_name,
  a.allocated_role, a.allocation_start,
  s.designation AS designation_at_allocation
FROM emp_allocation_log AS a
LEFT JOIN employees AS e ON e.emp_id = a.emp_id
LEFT JOIN designation_spans AS s
  ON s.emp_id = a.emp_id
 AND a.allocation_start >= s.valid_from
 AND (s.valid_until IS NULL OR a.allocation_start < s.valid_until)
ORDER BY a.allocation_id;
```

The interval comparison must be half-open. Same-date rows produce spans of zero
width, in which `valid_from` equals `valid_until`; the condition
`>= valid_from AND < valid_until` excludes them correctly. Substituting `<=`
causes an allocation whose start date falls exactly on a repeated date to match
two spans and duplicate — verified: under a closed comparison `A005` returns two
rows. The scalar-subquery formulation has no equivalent boundary condition, which
is why it is preferred as the primary answer.

---

## 7. Assumptions

1. **Same-date tiebreak.** Where two rows share an `effective_date` for one
   employee, the higher `txn_id` represents the later decision and takes
   precedence. The schema does not enforce this. It is the single assumption that
   would change if the business rule differed.

   `txn_id` is declared `VARCHAR`, so the comparison is lexicographic rather than
   numeric. It agrees with insertion order only while identifiers remain
   zero-padded to a fixed width: `'T1000'` sorts before `'T999'`. A `created_at`
   timestamp, or `effective_date` widened to `DATETIME`, would remove the
   dependency entirely.

2. **Designation validity.** A designation is in force from its `effective_date`
   inclusive until the next row for that employee. The final row per employee is
   open-ended.

3. **`Resigned` is a value, not a tombstone.** Employment may resume, and
   employee history is not filtered on designation content.

4. **Unresolved lookups are reported, never dropped.** An allocation with no
   preceding designation appears in the report with a `NULL` designation.

5. **`emp_name` is consistent per `emp_id`.** Verified against the sample data: no
   `emp_id` carries more than one distinct `emp_name`. The schema does not
   guarantee this.
