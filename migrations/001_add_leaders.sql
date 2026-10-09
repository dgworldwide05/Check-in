-- 001_add_leaders.sql
-- Adds church leaders + member->leader assignments to the check-in database.
--
-- SAFE TO RE-RUN: every statement is idempotent. It never deletes or overwrites
-- members, attendance, birthdays, departments or locations. It only fills in
-- members.leader_id where it is still empty, so an assignment you made by hand
-- is never changed.
--
-- Works on MySQL 5.7+/8, MariaDB and TiDB Cloud. Run the whole file in one go
-- (same session) against your church_attendance database.
-- Source of the data: Dcn.xlsx (10 leaders, 73 member rows).

-- ======================================================================
-- STEP 1: schema
-- ======================================================================

CREATE TABLE IF NOT EXISTS leaders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- members.leader_id (added only if missing, so re-running is harmless)
SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE members ADD COLUMN leader_id INT NULL',
  'SELECT ''members.leader_id already exists''')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'members' AND COLUMN_NAME = 'leader_id');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

SET @sql = (SELECT IF(COUNT(*) = 0,
  'CREATE INDEX idx_members_leader_id ON members (leader_id)',
  'SELECT ''index already exists''')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'members' AND INDEX_NAME = 'idx_members_leader_id');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

-- ======================================================================
-- STEP 2: the leaders (same order as the Excel sheet)
-- ======================================================================

INSERT IGNORE INTO leaders (name) VALUES
  ('Ps. Loretta Essien'),
  ('DNC NATHANIEL'),
  ('DCN ISAAC'),
  ('SHP OLIVER'),
  ('DCNS GIFTY'),
  ('PS BISMARK'),
  ('DCNS IRENE'),
  ('Deacon Tom'),
  ('DCN ASAMOAH'),
  ('DNC ELLA NORTEY');

-- ======================================================================
-- STEP 3: the Excel roster, kept as a reference table
-- ======================================================================

-- phone         : cleaned to 0XXXXXXXXX (NULL when the sheet has no number)
-- name_norm     : lower-case name with extra spaces removed
-- phone_leaders : how many different leaders the sheet lists for this phone
-- name_leaders  : how many different leaders the sheet lists for this name
-- phone_first   : 1 for the first sheet row that uses this phone (used by 002)
DROP TABLE IF EXISTS leader_roster_import;
CREATE TABLE leader_roster_import (
  id INT AUTO_INCREMENT PRIMARY KEY,
  leader_name VARCHAR(100) NOT NULL,
  member_name VARCHAR(100) NOT NULL,
  name_norm VARCHAR(100) NOT NULL,
  phone VARCHAR(20) NULL,
  phone_leaders TINYINT NOT NULL,
  name_leaders TINYINT NOT NULL,
  phone_first TINYINT NOT NULL,
  KEY idx_roster_phone (phone),
  KEY idx_roster_name (name_norm)
);
INSERT INTO leader_roster_import
  (leader_name, member_name, name_norm, phone, phone_leaders, name_leaders, phone_first) VALUES
  ('Ps. Loretta Essien', 'Deacon Francis', 'deacon francis', '0504778590', 2, 1, 1),
  ('Ps. Loretta Essien', 'Emmanuel Obuobi', 'emmanuel obuobi', '0257291177', 1, 1, 1),
  ('Ps. Loretta Essien', 'Maame Amponsah Afriyie', 'maame amponsah afriyie', '0546133968', 1, 1, 1),
  ('Ps. Loretta Essien', 'Rebecca Boateng', 'rebecca boateng', '0548268347', 1, 1, 1),
  ('Ps. Loretta Essien', 'Stephen Atebisa', 'stephen atebisa', '0557337004', 1, 1, 1),
  ('Ps. Loretta Essien', 'Jannibel', 'jannibel', '0246713473', 1, 1, 1),
  ('Ps. Loretta Essien', 'Charity Natibil', 'charity natibil', '0535354662', 1, 1, 1),
  ('Ps. Loretta Essien', 'Ellen White', 'ellen white', '0540511926', 1, 1, 1),
  ('DNC NATHANIEL', 'Nketia Opoku Bandoh', 'nketia opoku bandoh', '0599231501', 1, 1, 1),
  ('DNC NATHANIEL', 'Jonathan Ofosuhene', 'jonathan ofosuhene', '0549441089', 1, 1, 1),
  ('DNC NATHANIEL', 'francisca Nimo', 'francisca nimo', '0530186148', 3, 1, 1),
  ('DNC NATHANIEL', 'Jennifer Quansah', 'jennifer quansah', NULL, 0, 1, 0),
  ('DNC NATHANIEL', 'Rebecca Forson', 'rebecca forson', '0242129431', 1, 1, 1),
  ('DNC NATHANIEL', 'Rabbi Dogbe', 'rabbi dogbe', '0558426552', 1, 1, 1),
  ('DCN ISAAC', 'Dominic Owusu', 'dominic owusu', '0256200635', 1, 1, 1),
  ('DCN ISAAC', 'Prince Owusu', 'prince owusu', '0508783759', 1, 1, 1),
  ('DCN ISAAC', 'Prince Agbe', 'prince agbe', '0597721850', 1, 1, 1),
  ('DCN ISAAC', 'Cindylove Owusu', 'cindylove owusu', '0248416749', 1, 1, 1),
  ('DCN ISAAC', 'Pascaline Quansah', 'pascaline quansah', NULL, 0, 1, 0),
  ('DCN ISAAC', 'Vanessa', 'vanessa', '0530749392', 1, 1, 1),
  ('SHP OLIVER', 'Jehoshaphat Quansah', 'jehoshaphat quansah', '0557962288', 1, 1, 1),
  ('SHP OLIVER', 'Abigail Kwarteng', 'abigail kwarteng', '0595591134', 1, 1, 1),
  ('SHP OLIVER', 'Nice Aheto', 'nice aheto', '0552911277', 1, 1, 1),
  ('SHP OLIVER', 'George Adu Gyamfi', 'george adu gyamfi', '0597054440', 1, 1, 1),
  ('SHP OLIVER', 'Mary Mensah', 'mary mensah', '0599078380', 1, 1, 1),
  ('SHP OLIVER', 'Shirley Owusu', 'shirley owusu', '0545981493', 1, 1, 1),
  ('SHP OLIVER', 'Precious Narh', 'precious narh', '0256864770', 1, 1, 1),
  ('DCNS GIFTY', 'Georgina Agbe', 'georgina agbe', '0248995343', 1, 1, 1),
  ('DCNS GIFTY', 'Gifty Owusu', 'gifty owusu', '0535390313', 1, 1, 1),
  ('DCNS GIFTY', 'Marian Theresah Ackun', 'marian theresah ackun', '0596306792', 1, 1, 1),
  ('DCNS GIFTY', 'Hannah Sapak', 'hannah sapak', '0596072130', 2, 1, 1),
  ('DCNS GIFTY', 'Francis Abel', 'francis abel', '0504778590', 2, 1, 0),
  ('PS BISMARK', 'Tracy Ampofowaa', 'tracy ampofowaa', '0247526309', 1, 1, 1),
  ('PS BISMARK', 'Francisca Nimoh', 'francisca nimoh', '0597780965', 1, 1, 1),
  ('PS BISMARK', 'Samuella Kwarteng Ofosu', 'samuella kwarteng ofosu', '0530186148', 3, 2, 0),
  ('PS BISMARK', 'Benjamin Annor Baah', 'benjamin annor baah', '0549293438', 1, 1, 1),
  ('PS BISMARK', 'Jeremy Gyabeng Baah', 'jeremy gyabeng baah', '0546192621', 1, 1, 1),
  ('PS BISMARK', 'Priscilla Serwaa', 'priscilla serwaa', '0532082598', 1, 1, 1),
  ('PS BISMARK', 'ADOM DEBBY', 'adom debby', '0246528246', 1, 1, 1),
  ('PS BISMARK', 'Eugene', 'eugene', '0536781455', 1, 1, 1),
  ('PS BISMARK', 'Ruth Agyemang', 'ruth agyemang', '0552779136', 1, 1, 1),
  ('PS BISMARK', 'Princess Reynold', 'princess reynold', '0247526309', 1, 1, 0),
  ('DCNS IRENE', 'Dennis Awuah', 'dennis awuah', '0242367266', 1, 1, 1),
  ('DCNS IRENE', 'Benedicta Appiah', 'benedicta appiah', '0268748941', 1, 1, 1),
  ('DCNS IRENE', 'Gifty Adjei Larbi', 'gifty adjei larbi', '0596802126', 1, 1, 1),
  ('DCNS IRENE', 'Leticia Osei Animah', 'leticia osei animah', '0257310210', 1, 1, 1),
  ('DCNS IRENE', 'Bismark Arthur', 'bismark arthur', '0504388407', 2, 1, 1),
  ('DCNS IRENE', 'Richmond Narh', 'richmond narh', '0504388407', 2, 2, 0),
  ('DCNS IRENE', 'LAWRENCIA ODURO', 'lawrencia oduro', '0530366483', 1, 1, 1),
  ('DCNS IRENE', 'Comfort Sapak', 'comfort sapak', '0504049904', 1, 1, 1),
  ('DCNS IRENE', 'Emelia', 'emelia', '0541653119', 1, 1, 1),
  ('DCNS IRENE', 'Bernice Appiah', 'bernice appiah', '0268748941', 1, 1, 0),
  ('Deacon Tom', 'Keziah Arthur', 'keziah arthur', '0554179964', 1, 1, 1),
  ('Deacon Tom', 'Deborah Osei', 'deborah osei', '0554179964', 1, 1, 0),
  ('Deacon Tom', 'Dominic Eshun', 'dominic eshun', '0557325403', 1, 1, 1),
  ('Deacon Tom', 'Bright Acheampong', 'bright acheampong', '0537764825', 1, 1, 1),
  ('Deacon Tom', 'Anthony Tuffuor', 'anthony tuffuor', '0256967117', 1, 1, 1),
  ('Deacon Tom', 'Stephen Obeng', 'stephen obeng', '0598220576', 1, 1, 1),
  ('Deacon Tom', 'Franklin Owusu', 'franklin owusu', '0555002294', 1, 1, 1),
  ('Deacon Tom', 'Rosemond Narh', 'rosemond narh', '0530027627', 1, 1, 1),
  ('Deacon Tom', 'Bernard Kofi', 'bernard kofi', '0246139067', 1, 1, 1),
  ('Deacon Tom', 'Mensah Caleb', 'mensah caleb', '0532690206', 1, 1, 1),
  ('Deacon Tom', 'Samuella Kwarteng Ofosu', 'samuella kwarteng ofosu', '0530186148', 3, 2, 0),
  ('DCN ASAMOAH', 'Samuel Owusu Bob', 'samuel owusu bob', '0507339966', 1, 1, 1),
  ('DCN ASAMOAH', 'Peter Brenya', 'peter brenya', '0559910382', 1, 1, 1),
  ('DCN ASAMOAH', 'Jacob Amoako Boateng', 'jacob amoako boateng', '0257130984', 1, 1, 1),
  ('DCN ASAMOAH', 'Patrick Eshun', 'patrick eshun', '0591272503', 1, 1, 1),
  ('DCN ASAMOAH', 'Richmond Narh', 'richmond narh', '0504388407', 2, 2, 0),
  ('DNC ELLA NORTEY', 'Anning Stephen', 'anning stephen', '0539151769', 1, 1, 1),
  ('DNC ELLA NORTEY', 'Daniel Appiah', 'daniel appiah', '0548251625', 1, 1, 1),
  ('DNC ELLA NORTEY', 'Nana Ama Nyarko', 'nana ama nyarko', '0547129955', 1, 1, 1),
  ('DNC ELLA NORTEY', 'Priscilla Agbe', 'priscilla agbe', '0509271199', 1, 1, 1),
  ('DNC ELLA NORTEY', 'Sandra Mensah', 'sandra mensah', '0596072130', 2, 1, 0);

-- ======================================================================
-- STEP 4: link EXISTING members to their leader (only where it can be matched reliably)
-- ======================================================================

-- Phone numbers are compared after cleaning ("+233244123456" == "0244123456").

-- Rule A: the phone number appears under exactly ONE leader in the sheet.
UPDATE members m
JOIN (
  SELECT r.phone, MIN(l.id) AS leader_id
  FROM leader_roster_import r JOIN leaders l ON l.name = r.leader_name
  WHERE r.phone IS NOT NULL AND r.phone_leaders = 1
  GROUP BY r.phone
) x ON x.phone = (CASE WHEN REPLACE(TRIM(m.phone),' ','') LIKE '+233%' THEN CONCAT('0',SUBSTRING(REPLACE(TRIM(m.phone),' ',''),5)) ELSE REPLACE(TRIM(m.phone),' ','') END)
SET m.leader_id = x.leader_id
WHERE m.leader_id IS NULL;

-- Rule B: the phone is shared by people under DIFFERENT leaders in the sheet,
-- so the member's NAME must also match, and that name must sit under one leader.
UPDATE members m
JOIN (
  SELECT r.phone, r.name_norm, MIN(l.id) AS leader_id
  FROM leader_roster_import r JOIN leaders l ON l.name = r.leader_name
  WHERE r.phone IS NOT NULL AND r.phone_leaders > 1 AND r.name_leaders = 1
  GROUP BY r.phone, r.name_norm
) x ON x.phone = (CASE WHEN REPLACE(TRIM(m.phone),' ','') LIKE '+233%' THEN CONCAT('0',SUBSTRING(REPLACE(TRIM(m.phone),' ',''),5)) ELSE REPLACE(TRIM(m.phone),' ','') END) AND x.name_norm = LOWER(TRIM(REPLACE(REPLACE(REPLACE(m.name,'  ',' '),'  ',' '),'  ',' ')))
SET m.leader_id = x.leader_id
WHERE m.leader_id IS NULL;

-- Rule C: the sheet has NO phone for this person, so match on the exact full
-- name, only when that name is unique in both the sheet and the database.
UPDATE members m
JOIN (
  SELECT r.name_norm, MIN(l.id) AS leader_id
  FROM leader_roster_import r JOIN leaders l ON l.name = r.leader_name
  WHERE r.phone IS NULL AND r.name_leaders = 1
  GROUP BY r.name_norm
) x ON x.name_norm = LOWER(TRIM(REPLACE(REPLACE(REPLACE(m.name,'  ',' '),'  ',' '),'  ',' ')))
JOIN (
  SELECT LOWER(TRIM(REPLACE(REPLACE(REPLACE(name,'  ',' '),'  ',' '),'  ',' '))) AS name_norm, COUNT(*) AS c FROM members GROUP BY LOWER(TRIM(REPLACE(REPLACE(REPLACE(name,'  ',' '),'  ',' '),'  ',' ')))
) u ON u.name_norm = x.name_norm AND u.c = 1
SET m.leader_id = x.leader_id
WHERE m.leader_id IS NULL;

-- People the sheet lists under TWO leaders (Richmond Narh, Samuella Kwarteng Ofosu)
-- are deliberately left unassigned: the sheet can't say which leader is right.
-- Assign them from Attendance Dashboard > "+ Add member", or see MIGRATION.md.

-- ======================================================================
-- STEP 5: result
-- ======================================================================

SELECT COUNT(*) AS total_people,
       SUM(leader_id IS NOT NULL) AS with_leader,
       SUM(leader_id IS NULL) AS without_leader
FROM members;
