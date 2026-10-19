"""Windows cleanup shim for the installed gltest Direct Mode bootstrap.

The current gltest loader replaces fd 0 with a named temp file and immediately
unlinks it. Windows rejects that unlink while fd 0 still references the file.
Keep the file until contract import has consumed it, then restore stdin and remove
only the exact temp file created by this bootstrap. Linux/macOS use the upstream
implementation unchanged.
"""
import os
import sys


if sys.platform == "win32":
    from gltest.direct import loader, wasi_mock

    _inject = loader._inject_message_to_fd0
    _load = loader._load_module

    def _inject_deferred_unlink(vm):
        paths = []
        unlink = os.unlink

        def capture(path, *args, **kwargs):
            paths.append(path)

        os.unlink = capture
        try:
            _inject(vm)
        finally:
            os.unlink = unlink
        vm._unlockcheck_message_path = paths[-1] if paths else None

    def _load_then_restore_stdin(path):
        vm = wasi_mock.get_vm()
        try:
            return _load(path)
        finally:
            saved_stdin = getattr(vm, "_original_stdin_fd", None)
            if saved_stdin is not None:
                os.dup2(saved_stdin, 0)
                os.close(saved_stdin)
                vm._original_stdin_fd = None
            temp_path = getattr(vm, "_unlockcheck_message_path", None)
            if temp_path:
                os.unlink(temp_path)
                vm._unlockcheck_message_path = None

    loader._inject_message_to_fd0 = _inject_deferred_unlink
    loader._load_module = _load_then_restore_stdin
