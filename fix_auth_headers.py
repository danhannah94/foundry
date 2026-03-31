#!/usr/bin/env python3

import re

# Read the file
with open('packages/api/src/routes/__tests__/annotations.test.ts', 'r') as f:
    content = f.read()

# Pattern to match request(app).post|get|patch and add auth header
# Look for: request(app) followed by .post|.get|.patch, then add .set() before .send() or .query() or .expect()
pattern = r'(request\(app\)\s*\.(post|get|patch)\([^)]+\))(\s*)(\.(?:send|query|expect))'
replacement = r'\1\3.set("Authorization", "Bearer test-token")\3\4'

# Apply the replacement
new_content = re.sub(pattern, replacement, content, flags=re.MULTILINE)

# Write back
with open('packages/api/src/routes/__tests__/annotations.test.ts', 'w') as f:
    f.write(new_content)

print("Updated auth headers in annotations.test.ts")