-- 002_optional_seed_roster_members.sql   (OPTIONAL)
-- Run 001_add_leaders.sql first.
--
-- Adds people who are in Dcn.xlsx but have never checked in / been registered,
-- so they can check in with their phone number from day one and their leader
-- shows up straight away. Skip this file if you only want the leaders applied
-- to people who are already in the database.
--
-- Safe to re-run. It will NOT create a duplicate: a person is skipped if their
-- phone number OR their exact full name is already in the members table.
-- It skips people with no phone number, and phone numbers the sheet gives to
-- people under different leaders (can't tell which leader is right).
-- Only name, phone, status 'member' and leader are filled in; birthday,
-- department and location stay empty until they are known.

INSERT INTO members (name, phone, type, leader_id)
SELECT r.member_name, r.phone, 'member', l.id
FROM leader_roster_import r
JOIN leaders l ON l.name = r.leader_name
WHERE r.phone IS NOT NULL
  AND r.phone_leaders = 1
  AND r.phone_first = 1
  AND NOT EXISTS (SELECT 1 FROM members m WHERE (CASE WHEN REPLACE(TRIM(m.phone),' ','') LIKE '+233%' THEN CONCAT('0',SUBSTRING(REPLACE(TRIM(m.phone),' ',''),5)) ELSE REPLACE(TRIM(m.phone),' ','') END) = r.phone)
  AND NOT EXISTS (SELECT 1 FROM members m WHERE LOWER(TRIM(REPLACE(REPLACE(REPLACE(m.name,'  ',' '),'  ',' '),'  ',' '))) = r.name_norm);

SELECT COUNT(*) AS total_people, SUM(leader_id IS NOT NULL) AS with_leader FROM members;
