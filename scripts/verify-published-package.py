#!/usr/bin/env python3
"""公開中の拡張機能パッケージが、提出した zip と一致するかを調べる（読み取り専用）。

Chrome ウェブストアと Edge アドオンの「更新エンドポイント」から、いま公開されている CRX を
取得し、提出した zip の各ファイルと SHA-256 で突き合わせる。版番号だけでは「作った版が入って
いる」証拠にならないため（同じ 1.4.4 でも中身が違いうる）、ファイルの中身で確かめる。

ストアが加工する部分は比較から外す（2026-10-08 に公開中の v1.4.3 で実測して確認）:
  - manifest.json に `update_url` が足される（それ以外のキーと値は同一）
  - `_metadata/` が足される（verified_contents.json）
それ以外のファイルは、提出した zip と1バイトも違わない。

使い方:
  python3 scripts/verify-published-package.py --zip letus-task-watcher-1.4.4.zip --expect-version 1.4.4
  python3 scripts/verify-published-package.py --hashes store-submission-v1.4.4.sha256 --expect-version 1.4.4
  python3 scripts/verify-published-package.py --zip letus-task-watcher-1.4.4.zip --write-hashes store-submission-v1.4.4.sha256
（zip は gitignore 対象で消えうるため、提出した zip の各ファイルの SHA-256 を `--write-hashes` でリポに残し、
  後から `--hashes` で突き合わせられるようにする。ビルドは決定的で、同じ版のソースから作り直せば同じ中身になる）

終了コード:
  0 = 両ストアとも公開中の版が期待どおりで、中身も一致
  1 = 期待の版が公開されているが、中身が提出した zip と違う（要調査）
  2 = まだ公開されていないストアがある（審査中など。不一致は無い）
  3 = 取得・解析に失敗（ネットワークなど。結論は出せない）
"""
import argparse
import hashlib
import io
import json
import struct
import sys
import urllib.request
import zipfile

# 拡張機能のID（公開ページのURL末尾）。Edge と Chrome は別のID。
STORES = {
    'Edge': {
        'id': 'femdjgdgelnbdpgnfehacobmpbfmbdoa',
        'url': 'https://edge.microsoft.com/extensionwebstorebase/v1/crx'
               '?response=redirect&prod=chromiumcrx&prodchannel=&prodversion=130.0.0.0'
               '&x=id%3D{id}%26installsource%3Dondemand%26uc',
    },
    'Chrome': {
        'id': 'eofgkmpiadoeckkliialkddacidcinml',
        'url': 'https://clients2.google.com/service/update2/crx'
               '?response=redirect&prodversion=130.0.0.0&acceptformat=crx2,crx3'
               '&x=id%3D{id}%26uc',
    },
}
IGNORED_PREFIXES = ('_metadata/',)
STORE_ADDED_MANIFEST_KEYS = ('update_url',)


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def crx_to_zip(data):
    if data[:4] != b'Cr24':
        raise ValueError('CRX ではない（先頭が Cr24 でない）')
    ver = struct.unpack('<I', data[4:8])[0]
    if ver == 3:
        off = 12 + struct.unpack('<I', data[8:12])[0]
    elif ver == 2:
        pk, sig = struct.unpack('<II', data[8:16])
        off = 16 + pk + sig
    else:
        raise ValueError(f'未知のCRX版 {ver}')
    return zipfile.ZipFile(io.BytesIO(data[off:]))


def file_hashes(z, normalize_manifest):
    out = {}
    for info in z.infolist():
        name = info.filename
        if name.endswith('/') or name.startswith(IGNORED_PREFIXES):
            continue
        body = z.read(info)
        if normalize_manifest and name == 'manifest.json':
            m = json.loads(body)
            for k in STORE_ADDED_MANIFEST_KEYS:
                m.pop(k, None)
            body = json.dumps(m, sort_keys=True, ensure_ascii=False).encode('utf-8')
        out[name] = hashlib.sha256(body).hexdigest()
    return out


def load_hashes(path):
    out = {}
    with open(path, encoding='utf-8') as f:
        for line in f:
            line = line.rstrip('\n')
            if not line or line.startswith('#'):
                continue
            digest, _, name = line.partition('  ')
            out[name] = digest
    return out


def check_store(name, expect_version, ours):
    conf = STORES[name]
    z = crx_to_zip(fetch(conf['url'].format(id=conf['id'])))
    live_version = json.loads(z.read('manifest.json')).get('version')
    if live_version != expect_version:
        return 'pending', f'[{name}] 公開中の版は {live_version}（期待 {expect_version}）＝まだ公開されていない'
    pub = file_hashes(z, normalize_manifest=True)
    diff = sorted(f for f in ours if f in pub and pub[f] != ours[f])
    missing = sorted(f for f in ours if f not in pub)
    extra = sorted(f for f in pub if f not in ours)
    if diff or missing or extra:
        return 'mismatch', (f'[{name}] 版は {live_version} だが中身が違う: 内容の差={diff} '
                            f'公開側に無い={missing} 公開側だけにある={extra}')
    return 'match', f'[{name}] 版 {live_version}・{len(ours)}ファイルが提出した zip と完全一致'


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument('--zip', help='提出した zip')
    src.add_argument('--hashes', help='提出した zip の各ファイルの SHA-256 一覧（--write-hashes で作ったもの）')
    ap.add_argument('--expect-version', help='公開されているはずの版（例 1.4.4）')
    ap.add_argument('--write-hashes', help='--zip の各ファイルの SHA-256 をこのパスへ書いて終了する（通信しない）')
    args = ap.parse_args()

    if args.hashes:
        ours = load_hashes(args.hashes)
    else:
        ours = file_hashes(zipfile.ZipFile(args.zip), normalize_manifest=True)
    if args.write_hashes:
        if not args.zip:
            ap.error('--write-hashes には --zip が要る')
        with open(args.write_hashes, 'w', encoding='utf-8') as f:
            for name in sorted(ours):
                f.write(f'{ours[name]}  {name}\n')
        print(f'{len(ours)}ファイルの SHA-256 を {args.write_hashes} へ書いた')
        return 0
    if not args.expect_version:
        ap.error('--expect-version が要る')
    results = {}
    for name in STORES:
        try:
            results[name] = check_store(name, args.expect_version, ours)
        except Exception as e:  # ネットワーク・解析の失敗は結論にしない
            results[name] = ('error', f'[{name}] 取得・解析に失敗: {type(e).__name__}: {e}')
    for _, msg in results.values():
        print(msg)
    states = {s for s, _ in results.values()}
    if 'error' in states:
        code = 3
    elif 'mismatch' in states:
        code = 1
    elif 'pending' in states:
        code = 2
    else:
        code = 0
    print({0: 'RESULT: 両ストアとも一致', 1: 'RESULT: 中身が不一致（要調査）',
           2: 'RESULT: まだ公開されていないストアがある', 3: 'RESULT: 取得失敗（結論なし）'}[code])
    return code


if __name__ == '__main__':
    sys.exit(main())
