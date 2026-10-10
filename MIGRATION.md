# Leaders & member assignments: migration guide

This update adds church leaders to the check-in system. Every member can be linked to a leader, and the leader's name shows at check-in, in the attendance table, in search and in the CSV exports.

The source of truth is `Dcn.xlsx` (10 leaders, 73 member rows). The data from it is already built into the SQL files below, so you don't need the spreadsheet to run anything.

## Quick version: just deploy

The first time the new server starts, it creates the leader tables and links your existing members to their leaders automatically (same rules as 001, below). Watch the logs for `Linked existing members to leaders: X of Y`. It runs **once only**, so leaders you change later are never touched on restart. Everything below is the manual route, which is optional and also safe to run afterwards.

## What you need to do (about 5 minutes)

1. **Back up your database** (TiDB Cloud: take a backup / export first). The migration only adds things and fills in empty `leader_id` values, but a backup is always wise.
2. **Run `migrations/001_add_leaders.sql`** on your `church_attendance` database. In the TiDB Cloud SQL Editor, paste the whole file and run it in one go. It is safe to run more than once.
   The last line of output shows how many people now have a leader.
3. **Deploy the new code** (replace the project files / push to GitHub so Render redeploys). No new npm packages are needed.
4. *(Optional)* **Run `migrations/002_optional_seed_roster_members.sql`** if you want everyone in the spreadsheet who has never been registered to be added, so they can check in with their phone number straight away. See "Optional step" below.
5. **Run the queries in `migrations/003_review_leader_assignments.sql`** one at a time to see who still has no leader.

The order of steps 2 and 3 doesn't matter. When the server starts, it creates the `leaders` table and `members.leader_id` column by itself if they're missing, so the site never breaks if the code goes live first. Linking *existing* members to their leaders only happens when you run step 2.

## What the migration changes in the database

| Change | Detail |
|---|---|
| New table `leaders` | `id`, `name` (unique). The 10 leaders from the sheet, in sheet order. |
| New column `members.leader_id` | Nullable `INT`, indexed. This is where the member → leader link is saved. |
| New table `leader_roster_import` | A read-only copy of the spreadsheet, used for matching and for the review queries. You can `DROP TABLE leader_roster_import;` once you're happy. |
| `attendance` table | **Not changed.** The attendance table shows the leader by looking up the member's saved leader, so past attendance rows show their leader too. |

Nothing is deleted. Names, phones, birthdays, departments, locations and attendance history are left as they are. The migration only fills `leader_id` where it is empty, so a leader you assign by hand is never overwritten, even if you re-run it.

## How existing members are matched

Phone numbers are compared after cleaning, so `+233244123456` and `0244123456` count as the same number.

- **Rule A:** the member's phone appears in the sheet under exactly one leader, so they get that leader.
- **Rule B:** the sheet lists the same phone for people under *different* leaders, so the member's full name must also match.
- **Rule C:** the sheet has no phone for the person, so the exact full name is used, only if that name is unique in both the sheet and your database.

Anything that can't be matched reliably is left without a leader (it shows as "—") rather than guessed.

## Things in the spreadsheet that need a human decision

- **Two people are listed under two leaders each.** A member can have only one leader, so these are left unassigned until you decide:
  - **Richmond Narh** is under both DCNS IRENE and DCN ASAMOAH.
  - **Samuella Kwarteng Ofosu** is under both PS BISMARK and Deacon Tom.
- **Some people share one phone number**, and the system identifies people by phone number (it must be unique). Only one person per number can exist in the system, which was already the case before this update:
  - 0504778590: Deacon Francis (Ps. Loretta Essien) and Francis Abel (DCNS GIFTY)
  - 0530186148: francisca Nimo and Samuella Kwarteng Ofosu
  - 0596072130: Hannah Sapak (DCNS GIFTY) and Sandra Mensah (DNC ELLA NORTEY)
  - 0504388407: Bismark Arthur and Richmond Narh (both DCNS IRENE)
  - 0554179964: Keziah Arthur and Deborah Osei (both Deacon Tom)
  - 0247526309: Tracy Ampofowaa and Princess Reynold (both PS BISMARK)
  - 0268748941: Benedicta Appiah and Bernice Appiah (both DCNS IRENE)

  When both people are under the same leader, whichever of them is in the database gets that leader. When they're under different leaders, the name decides. If those people should be separate members, give each their own phone number.
- **Two people have no phone number in the sheet:** Jennifer Quansah (DNC NATHANIEL) and Pascaline Quansah (DCN ISAAC). They're matched by exact name only.
- **Leader names are copied exactly as typed in the sheet** (for example `DNC NATHANIEL`, `DCNS GIFTY`). If any should read differently (for example "DCN" instead of "DNC"), rename the leader once:
  `UPDATE leaders SET name = 'DCN NATHANIEL' WHERE name = 'DNC NATHANIEL';`
  Do this *after* running 001, because 001 finds leaders by those names.

## Fixing or changing a leader afterwards

- **From the dashboard:** open **+ Add member**, enter the person's exact name and phone, pick the leader and submit. If that person is already registered *without* a leader, they get assigned the leader you picked. If they already have a leader, you'll get a message saying who it is and nothing is changed.
- **With SQL:** change someone's leader, whatever it is now:
  ```sql
  UPDATE members
  SET leader_id = (SELECT id FROM leaders WHERE name = 'DCNS IRENE')
  WHERE phone = '0504388407';
  ```

## Optional step: `002_optional_seed_roster_members.sql`

This adds people who are in the sheet but not in your database, as `member`s under their leader, with only name, phone and leader filled in (birthday, department and location stay empty until known). It skips anyone whose phone number or exact name is already in the database (no duplicates), anyone with no phone number, and the conflicting shared numbers listed above. If you only want leaders applied to people who already exist, skip this file.

## New features in the app

- **Check-in (phone / QR or manual):** the leader's name is shown after a check-in. The dashboard's manual check-in message reads, for example, `John Mensah checked in! Leader: Ps. Loretta Essien`. The public check-in page shows `Your leader: …` on the welcome screen. This works for new members the same way once they're registered with a leader.
- **Attendance Dashboard:**
  - New **Leader** column (also for past dates).
  - The search box now also searches by leader name.
  - The CSV export includes a **Leader** column.
  - New **+ Add member** button (name, phone, birthday, location, member/visitor, department, and a **Leader** dropdown of the existing leaders). It saves the person and their leader, and doesn't check them in. Leader is required for members and optional for visitors.
  - The manual "Check someone in → New / details" form has an optional **Leader** dropdown.
- **All Members page:** new Leader column, search and CSV column.
- Phone lookups now accept `0244123456`, `+233244123456` and `233244123456` interchangeably, so a member is found however the number is typed.

## Fresh installs

`setup.sql` now creates the `leaders` table and `members.leader_id`. On a brand-new database the server adds the 10 leaders the first time it starts.
