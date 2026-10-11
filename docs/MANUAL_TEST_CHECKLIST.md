# Manual / device test checklist

These checks need a physical device or emulator. Automated tests can't reach them, and none were run in the build environment. Record the date, the device and the result for each.

## Core loop (offline)
- [ ] Turn on airplane mode, open the app for the first time, complete onboarding, and confirm no network errors appear.
- [ ] Build a programme manually and approve it. Home shows today's plan, or a rest day.
- [ ] Start the workout and log 3 sets. Each one shows "✓ saved".
- [ ] Force-close the app mid-workout and reopen it. The workout resumes with every logged set and the elapsed time.
- [ ] Delete a set, then tap **Undo**. The set is restored.
- [ ] Edit a logged set. The new values are saved.
- [ ] Pause for one minute, then resume. The duration excludes the pause.
- [ ] Substitute an exercise after logging sets. The logged sets stay on the original exercise.
- [ ] Finish. The summary shows the correct status (as planned, adapted or partial) and any PRs. Next time, the progression suggestion appears.

## Adaptive Day
- [ ] On a scheduled day, open **Adapt today's workout**, choose 20 minutes and "Usual" equipment. The proposal is labelled "Shortened …", with included and deferred items, each with a reason.
- [ ] Choose "Minimal" equipment. Substitutions show "for <original>".
- [ ] Choose 5 minutes. The result says "No realistic session today" and offers reschedule and habit-action options.
- [ ] Approve and complete the session. The summary says "Original plan: … preserved" and the status is `completed_adapted`. The calendar shows "Completed (adapted)".
- [ ] Reschedule a day. It appears on the new date, and the streak is unchanged.

## Accountability
- [ ] Planned rest days don't break the streak, and skipping with "Unwell" doesn't either.
- [ ] A habit action earns +5 XP once per day and isn't counted as a workout.
- [ ] Record a weekly review. XP is awarded once, and recording again doesn't add more.
- [ ] Reminders: enable them. The notification permission prompt appears, and a notification arrives on a planned day.

## Progress & privacy
- [ ] Add photos from the camera and from the library. They appear in the timeline, and **Compare** works.
- [ ] Long-press a photo to delete it. It disappears from the device.
- [ ] Log weight and measurements. The chart updates, and switching to imperial units converts the display.

## Cloud (needs a Supabase project)
- [ ] Sign up or sign in, then enable backup. The pending count drops to 0.
- [ ] Turn on airplane mode, log a workout, then go back online. It syncs automatically, and the server has no duplicate rows.
- [ ] Sign in on a second device or emulator. Data is restored and XP matches. A photo shows "tap to load" and opens through a signed URL.
- [ ] Expire or revoke the session (sign out on the server). The status shows "Sign in needed" and local data is untouched.
- [ ] Photo upload fails (airplane mode during upload): the photo shows "Backup failed", then succeeds on retry.
- [ ] Delete the cloud backup. The bucket folder and the rows are gone, and local data remains.
- [ ] Delete the account. Signing in again fails.

## AI (needs Groq secrets)
- [ ] With AI off, nothing is sent and the Coach tab shows the notice.
- [ ] Enable AI and ask a question. The answer shows its model, caveats and missing data.
- [ ] Generate an AI draft. It is saved as **Draft — not active** and must be approved in the editor.
- [ ] Exhaust the quota (set `AI_USER_DAILY_LIMIT=1`). You get a clear message, and workout logging is unaffected.

## Accessibility
- [ ] With the largest system font size, the logger is still usable.
- [ ] TalkBack/VoiceOver reads the buttons, set rows and status pills.
- [ ] Contrast in gym lighting: the accent on black and the muted text are readable.
