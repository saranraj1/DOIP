"""Mulberry32 PRNG — exact Python port of src/sim/prng.ts.

Same bit operations, same constant (0x6d2b79f5). Running the same seed
produces bit-identical float sequences to the TypeScript version, which
guarantees that a run seeded on the backend can be replayed deterministically
on the frontend (and vice-versa) via the recorded event log.
"""

import ctypes
from typing import Callable

Rand = Callable[[], float]


def _u32(n: int) -> int:
    """Truncate to unsigned 32-bit, matching JS `>>> 0`."""
    return ctypes.c_uint32(n).value


def _i32(n: int) -> int:
    """Signed 32-bit, matching JS `| 0`."""
    return ctypes.c_int32(n).value


def _imul(a: int, b: int) -> int:
    """Math.imul equivalent — 32-bit signed integer multiply."""
    return _i32(_u32(a) * _u32(b))


def mulberry32(seed: int) -> Rand:
    """Return a PRNG closure seeded with `seed` (uint32)."""
    state = [_u32(seed)]

    def next_() -> float:
        a = state[0]
        a = _i32(a)
        a = _u32(_i32(a + _i32(0x6D2B79F5)))
        t = _imul(_u32(a ^ _u32(a >> 15)), _u32(1 | a))
        t = _u32(_u32(t + _imul(_u32(t ^ _u32(t >> 7)), _u32(61 | t))) ^ t)
        result = _u32(t ^ _u32(t >> 14))
        state[0] = a
        return result / 4294967296.0

    return next_


def pick(rand: Rand, arr: list):
    return arr[int(rand() * len(arr))]


def between(rand: Rand, a: float, b: float) -> float:
    return a + rand() * (b - a)
