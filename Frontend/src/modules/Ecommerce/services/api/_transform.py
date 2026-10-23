import re, sys, io

path = sys.argv[1]
with io.open(path, encoding="utf-8") as f:
    src = f.read()

PREFIXED = ("catalog", "admin", "user", "seller", "orders", "delivery", "content")

def repl(m):
    quote = m.group(1)
    body = m.group(2)
    first_seg = body.split("/", 1)[0]
    if first_seg in PREFIXED:
        if first_seg == "content":
            # ecommerce landing router is mounted at '/', not '/content' -- strip it.
            rest = body[len("content"):]
            return f'{quote}/ecommerce{rest}{quote}'
        return f'{quote}/ecommerce{body[0:0]}{body and "/" + body if False else ""}' if False else f'{quote}/ecommerce/{body}{quote}'
    return m.group(0)

# Match "/word..." or `/word...` string/template literals starting with /
pattern = re.compile(r'(["`])(/[a-zA-Z][a-zA-Z0-9/_.:${}-]*)\1')

def repl2(m):
    quote = m.group(1)
    body = m.group(2)[1:]  # strip leading /
    first_seg = body.split("/", 1)[0]
    if first_seg in PREFIXED:
        if first_seg == "content":
            rest = body[len("content"):]
            return f'{quote}/ecommerce{rest}{quote}'
        return f'{quote}/ecommerce/{body}{quote}'
    return m.group(0)

out = pattern.sub(repl2, src)

with io.open(path, "w", encoding="utf-8", newline="\n") as f:
    f.write(out)

print("done")
