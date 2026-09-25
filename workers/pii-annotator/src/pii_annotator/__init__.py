"""Munin PII annotation worker.

Claims conversation messages from a Munin backend, runs person-name NER over
them, and submits the spans it finds. It never connects to Postgres: every
read and write goes through the backend's worker endpoints, which apply the
owning org's tenancy.
"""

__version__ = "0.1.0"
