import struct
import os

# List all session.dat files in ASSETS
ASSETS_DIR = os.path.join(os.path.dirname(__file__), '../ASSETS')
session_files = []
for root, dirs, files in os.walk(ASSETS_DIR):
    for f in files:
        if f == 'session.dat':
            session_files.append(os.path.join(root, f))

print(f"Found {len(session_files)} session.dat files:")
for f in session_files:
    print(f"  {f}")

all_types = set()

for session_path in session_files:
    types_found = set()
    with open(session_path, "rb") as f:
        data = f.read()
    png_header = b"\x89PNG\r\n\x1a\n"
    offset = 0
    while True:
        idx = data.find(png_header, offset)
        if idx == -1:
            break
        end_idx = data.find(b"IEND", idx)
        if end_idx != -1:
            type_offset = end_idx + 8
            if type_offset + 4 <= len(data):
                type_val = struct.unpack("<I", data[type_offset:type_offset+4])[0]
                types_found.add(type_val)
                all_types.add(type_val)
        offset = idx + 8
    print(f"{session_path}: {len(types_found)} unique types: {sorted(types_found)}")

print("\nAll unique type values across all session.dat files:")
print(sorted(all_types))
