# Reference research

Observed via REA on 2026-11-18 in the existing authorized Chrome session. Only generic UI patterns are retained. Account identifiers, message bodies, creator media, personal settings values, script sources, storage values and financial data are excluded from these notes.

## Evidence boundaries

REA passive accessibility/DOM inspections covered Home, the account's own profile, Discover, Settings/Edit profile, Notifications, Messages list and Collections. Capture was attach-limited and policy-filtered; it is not evidence of backend behavior, historical traffic or visual pixel measurements. No source code or assets were extracted. No purchase was made. A guessed subscriptions URL returned Home, so a dedicated subscription-management screen is **not verified**. Chrome navigation was performed with the Chrome DevTools connector because REA scenario mode cannot use this browser's WebSocket-only endpoint.

| Area | Purpose, hierarchy and interactions actually observed | FollowersOnly implementation decision |
| --- | --- | --- |
| Global shell | Navigation includes Home, Discover, Notifications, Messages, Collections, Subscriptions, My profile, More and New post. Main content and a secondary suggestions region occur in the accessibility hierarchy. | Persistent desktop navigation, content column, discovery rail; original violet branding. |
| Home | Home heading; composer textbox with Add media, poll/quiz/format controls; All filter; posts with Like, More, video play and Send tip controls. Suggestions include Show only free, Refresh and Discover more. | Paginated posts; original composer, authorized media, explicit lock state, likes/comments/bookmarks; omit unrequested poll/quiz/tip extensions. |
| Own creator profile | Copy profile link, search and profile-related controls, content hierarchy. | Cover/avatar, identity, bio, subscription controls, posts/media tabs. No personal reference details copied. |
| Discover | Discover heading, search, repeated content containers and shell controls. | Searchable fictional creator directory, categories, free/paid filtering. Ranking is independently designed. |
| Settings | Settings and Edit profile headings, Save, username/display-name/location/website inputs. | Editable account/creator forms and explicit save/error states. |
| Notifications | Notifications heading, Search users, shell and suggestions region. | Category filtering, unread state, mark read; independently generated event copy. |
| Messages list | Messages heading, Search, Newest first, More, All, Priority and Unread filters, repeated clear controls. No conversation bodies inspected or retained. | Searchable list, unread filter, private one-to-one thread and composer designed independently. |
| Collections | Collections heading, Create new list, Fans/Recent/Custom order headings, search/sort, profile links and subscription presentation. | Bookmarks and subscription management share shell; custom collections are outside the supplied core requirements. |

## Unverified states and inaccessible journeys

Registration, login, recovery, verification, creator onboarding, earnings, analytics, creator subscriber management, admin, payment confirmation, cancellation/refund, conversation detail, modal focus behavior, infinite-scroll mechanics, actual mobile breakpoints, hover states, exact color/spacing/type metrics, loading/error/empty states and subscription-renewal semantics were not established by these inspections. They must not be described as observed reference behavior. Implement these independently using documented product requirements and accessible web conventions. Research screenshots were deliberately not persisted because they could include personal or creator content.

## Independent state design

Each FollowersOnly data view has a loading skeleton, recoverable error message and actionable empty state. Forms use visible labels, validation and pending feedback. Dialogs use the native dialog focus model and Escape dismissal. Mobile uses bottom navigation and a full-width content pane. Subscription confirmation explicitly identifies the sandbox and requires confirmation. Locked post bodies and attachment identifiers are removed server-side before serialization.
