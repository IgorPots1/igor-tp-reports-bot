import zlib, struct, sys

def read_png(path):
    d = open(path,'rb').read()
    assert d[:8] == b'\x89PNG\r\n\x1a\n', 'не PNG'
    pos, idat, meta = 8, b'', {}
    while pos < len(d):
        ln = struct.unpack('>I', d[pos:pos+4])[0]
        typ = d[pos+4:pos+8]
        data = d[pos+8:pos+8+ln]
        if typ == b'IHDR':
            w,h,bd,ct,cm,fm,il = struct.unpack('>IIBBBBB', data)
            meta = dict(w=w,h=h,bd=bd,ct=ct,il=il)
        elif typ == b'IDAT': idat += data
        pos += 12 + ln
    assert meta['bd'] == 8 and meta['il'] == 0, 'нестандартный PNG'
    ch = {0:1,2:3,3:1,4:2,6:4}[meta['ct']]
    return meta, ch, zlib.decompress(idat)

def unfilter(raw, w, h, ch):
    stride = w*ch
    out = bytearray(h*stride)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        f = raw[p]; p += 1
        line = bytearray(raw[p:p+stride]); p += stride
        if f == 1:
            for i in range(ch, stride): line[i] = (line[i] + line[i-ch]) & 255
        elif f == 2:
            for i in range(stride): line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                a = line[i-ch] if i >= ch else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i-ch] if i >= ch else 0
                b = prev[i]; c = prev[i-ch] if i >= ch else 0
                pp = a+b-c; pa,pb,pc = abs(pp-a),abs(pp-b),abs(pp-c)
                pr = a if (pa<=pb and pa<=pc) else (b if pb<=pc else c)
                line[i] = (line[i] + pr) & 255
        out[y*stride:(y+1)*stride] = line
        prev = line
    return bytes(out)

def write_png(path, pix, w, h, ch, ct):
    stride = w*ch
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw += pix[y*stride:(y+1)*stride]
    comp = zlib.compress(bytes(raw), 9)
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t+d) & 0xffffffff)
    out = b'\x89PNG\r\n\x1a\n'
    out += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, ct, 0, 0, 0))
    out += chunk(b'IDAT', comp)
    out += chunk(b'IEND', b'')
    open(path,'wb').write(out)

def crop_top(src, dst, target_h):
    meta, ch, raw = read_png(src)
    w, h = meta['w'], meta['h']
    if h == target_h:
        open(dst,'wb').write(open(src,'rb').read()); return w, h
    pix = unfilter(raw, w, h, ch)
    write_png(dst, pix[:target_h*w*ch], w, target_h, ch, meta['ct'])
    return w, target_h

if __name__ == '__main__':
    print(crop_top(sys.argv[1], sys.argv[2], int(sys.argv[3])))
