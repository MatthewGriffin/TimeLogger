# Changelog

What's new in each version, written for the people using the app. These notes
appear in the update popup and on the GitHub release, so keep them in plain
language. A version with nothing to notice can say "No visible changes."

## 0.9.1-beta.3

- The Pull Requests page now shows 3 pull requests at a time and only asks GitHub for the ones on the page, so it loads much faster and uses far fewer requests. Going back to a page you've seen is instant.
- Searching the Pull Requests page covers the title, description, comments, repository, author and number. Searching by branch name no longer works.

## 0.9.1-beta.2

- Submit Time takes less room: the "all entries have been submitted" message is now a single line.
- In Local Entries vs Tempo, the status filters are now a dropdown, with a Refresh button on the same row.

## 0.9.1-beta.1

- On the Submit page, entries with no ticket can now get one. Ask the local AI to suggest tickets, then approve or dismiss each one (nothing is saved until you approve), or type a ticket on the row yourself.
- Time tickets now show their PI and type, like "PI 44 TIME-1234 Daily Scrum", in ticket lists and suggestions, under ticket fields, on the entry and note lists, on Daily Scrum, and when choosing a ticket for a meeting.
- Editing an entry now suggests tickets in the ticket box, and the search button with an empty task name also lists your time tickets, not only the tickets assigned to you.
- Fixed the update installer still failing with "Error opening file for writing". The app no longer restarts its background service while an update is installing. You may see the error once more, installing this version.

## 0.9.0

- Daily Scrum now lists the pull requests behind your open blockers, marked as blockers and shown first, and its pull request cards match the Pull Requests page.
- Meetings that match one of your Current Sprint keywords, like the Daily Scrum, now get their ticket automatically. The ones that don't match say why.
- Blockers on a note now show whether they're open or resolved, and you can resolve or reopen one from the note. A resolved blocker no longer comes back after the note is edited.
- The ticket list on Add Entry and notes says what each ticket is, always includes your current PI tickets, and the Jira search button lists your in-progress tickets when the name and ticket are empty.
- The PI Ticket Correction Review now sits below Local Entries vs Tempo on the Submit page, and looks like the rest of that page.
- The pull requests page no longer fails all its searches at once, retries when GitHub has a hiccup, and shows the first error if one still fails.
- You can roll back to an earlier version in Settings > About. The Main update channel is now called Stable, and the app checks for updates every few hours while it's open.
- Updates no longer interrupt you: an "Update available" button appears in the sidebar and shows what's new.
- The update installer no longer fails with "Error opening file for writing". The app now stops its background service before installing. You may see the error once more, installing this version.
- The dashboard workday target now leaves out lunch, so a full day no longer shows an hour remaining.

## 0.9.0-beta.7

- Meetings that match one of your Current Sprint keywords, like the Daily Scrum, now get their ticket automatically. The ones that don't match say why.
- The PI Ticket Correction Review now sits below Local Entries vs Tempo on the Submit page, and looks like the rest of that page.
- The pull requests page no longer fails all its searches at once, retries when GitHub has a hiccup, and shows the first error if one still fails.
- Fixed the update installer failing with "Error opening file for writing" on a native file. The app now stops its background service before installing. You may see the error once more, installing this version.
- The dashboard workday target now leaves out lunch, so a full day no longer shows an hour remaining.

## 0.9.0-beta.5

- The Jira search button on an entry now lists your in-progress tickets to pick from when the name and ticket are empty.
- Made saving the update channel safer, so it can't affect your other settings.

## 0.9.0-beta.4

- The ticket list on Add Entry and notes now says what each ticket is, and always includes your current PI tickets.

## 0.9.0-beta.3

- The notes list now shows whether each blocker is open or resolved.
- You can mark a blocker resolved, or reopen it, from the note itself.
- Fixed a resolved blocker reopening and returning to the Daily Scrum when the note was edited or filed under a category.

## 0.9.0-beta.2

- No visible changes.

## 0.9.0-beta.1

- You can now roll back to an earlier version in Settings > About, if a new one breaks something.
- The Main update channel is now called Stable. Choosing it on a beta build now offers the latest stable release, instead of saying you're up to date.
- The app now checks for updates every few hours while it's open, not only when it starts.
- Fixed a beta install moving to the Stable channel by itself after installing a stable version.

## 0.8.3-beta.2

- Updates no longer interrupt you. An "Update available" button appears in the sidebar instead, and clicking it shows what's new.
- The update popup now lists what changed in each version since yours.

## 0.8.3-beta.1

- No visible changes.

## 0.8.2

- Fixed the Beta update channel, which couldn't find new versions.

## 0.8.1

- No visible changes.

## 0.8.0

- Added a choice of Stable or Beta updates in Settings > About.
