━━━ USER COMMANDS ━━━

/link
    Link your Discord account to your reviewer profile.
    Usage: /link

/review create branch: feature/add-login type: frontend priority: low
    Create a review (auto-assigns reviewers).
    Optional: size: small|medium|large (auto-detected if not set)

/review create-commit branch: main commits: abc1234,def5678 type: backend priority: mid
    Create a review from 1-3 commit hashes (comma-separated).

/review approve id: REV-5
    Approve a review you were assigned to.

/review reject id: REV-5 comment: needs better error handling
    Reject a review with a reason.

/review fix-done id: REV-5
    Mark fixes as done and select who should re-review.

/review escalate id: REV-5
    Escalate a stuck review to a senior reviewer.

/review comment id: REV-5 comment: looks good overall
    Add a comment to any review.

/review status
    Show all currently active reviews.

/review details id: REV-5
    Show full details of a specific review.

/my-reviews
    Show all reviews assigned to you.
