# Spec Delta

## ADDED Requirements

### Requirement: One progress view for every save
Every save (create, Save edit, Add a key, Rename or archive, Unarchive, Archive and clear) SHALL show the same progress
view: a determinate bar exposed as `role="progressbar"` with `aria-valuemin`, `aria-valuemax`, `aria-valuenow` and an
`aria-valuetext` naming the step, above the list of steps. Finished steps SHALL show a check, the step in progress a
spinner, a failed step an error mark, and steps not reached a neutral mark. Steps MUST advance only on the write path's
real progress callbacks, never on a timer.

#### Scenario: Mid-save
- **WHEN** an edit has been encrypted and sponsored and is waiting to be signed
- **THEN** the bar reads "Step 4 of 5: Signed and sent", the first three steps are checked and "Signed and sent" shows a spinner

#### Scenario: No callbacks
- **WHEN** a save reports no progress for a while
- **THEN** no step is checked and the bar does not move

### Requirement: Save steps and the background copy
Saves of an existing vault SHALL list "Touch your key", "Encrypted on this device", "Network fee sponsored", "Signed
and sent" and "Confirmed on-chain". The create flow SHALL list the last four only, because its keys were touched during
setup. The Arweave copy SHALL be a separate line marked as happening in the background, outside the bar, and SHALL NOT
delay "Saved".

#### Scenario: Saved before the copy
- **WHEN** a save is confirmed on-chain and the Arweave copy is still uploading
- **THEN** the bar is full, "Saved." is shown, and the Arweave line shows a spinner with "in the background"

### Requirement: Slow steps and failures
After about 10 seconds on one step, the progress view SHALL add "Still working… this can take up to a minute." until
the step changes. When a save fails, the bar SHALL stop at the failed step with an error mark, next to the existing
error message and retry, with no spinner.

#### Scenario: Slow sponsor
- **WHEN** a save stays on "Network fee sponsored" for 10 seconds
- **THEN** the reassurance line appears, and it goes when the next step starts

#### Scenario: Failed while sending
- **WHEN** a save fails after the fee was sponsored
- **THEN** "Signed and sent" shows the error mark, the bar stays at step 4 of 5, and the error notice is shown

### Requirement: Unlock and loading feedback
Unlock and Reload SHALL show the steps "Touch your key", "Finding your vaults" and "Opening" in the same progress view,
only once the wait has lasted 300 ms; the key prompt itself is never delayed. Lazily loaded parts SHALL show a small
spinner with their loading text after a 300 ms delay, in a `role="status"` region marked `aria-busy`. "Check another key"
SHALL show the same unlock steps, and each vault row SHALL show a small spinner while its dates load. Lock SHALL stay
immediate. Progress and loaders MUST NOT move focus, SHALL announce at most one polite message per step change, and
under reduced motion SHALL show a static indicator and an instant bar.

#### Scenario: Quick unlock
- **WHEN** an unlock finishes within 300 ms
- **THEN** no progress view is shown

#### Scenario: Reduced motion
- **WHEN** the user prefers reduced motion and a save is in progress
- **THEN** the spinner does not rotate and the bar moves without animating
