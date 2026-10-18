Native implementation and SDK test: https://github.com/EA-LA/FYNX-app/pull/3

The current-local-integration.patch records only this task’s auth/root/project additions against preserved pre-task local files. It deliberately excludes unrelated app-icon changes. Do not apply it to the already-patched local checkout or the older native repository baseline without adapting context. The new module and test are full source files in the native draft PR.
