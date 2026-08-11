import ftplib
import os
import sys

REMOTE_NEWS = "/domains/pkrokosz.pl/public_html/news"
LOCAL_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def ensure_dir(ftp, path):
    try:
        ftp.cwd(path)
        return
    except ftplib.error_perm:
        parent, name = os.path.split(path.rstrip("/"))
        if parent and parent != path:
            ensure_dir(ftp, parent)
        try:
            ftp.mkd(name)
        except ftplib.error_perm:
            pass
        ftp.cwd(path)


def upload_tree(ftp, local_dir, remote_dir):
    ftp.cwd(remote_dir)
    for item in sorted(os.listdir(local_dir)):
        if item.startswith("."):
            continue
        lp = os.path.join(local_dir, item)
        rp = remote_dir.rstrip("/") + "/" + item
        if os.path.isdir(lp):
            ensure_dir(ftp, rp)
            upload_tree(ftp, lp, rp)
        else:
            with open(lp, "rb") as f:
                ftp.storbinary("STOR " + rp, f)
            print("OK  " + rp)


def main():
    host = os.environ.get("FTP_HOST")
    user = os.environ.get("FTP_USER")
    pwd = os.environ.get("FTP_PASS")
    if not host or not user or not pwd:
        print("ERROR: brak FTP_HOST/FTP_USER/FTP_PASS")
        sys.exit(1)

    ftp = ftplib.FTP(host, timeout=120)
    ftp.login(user, pwd)

    ensure_dir(ftp, REMOTE_NEWS)
    ftp.cwd(REMOTE_NEWS)
    for name in ["index.html", ".htaccess"]:
        lp = os.path.join(LOCAL_ROOT, name)
        if os.path.exists(lp):
            with open(lp, "rb") as f:
                ftp.storbinary("STOR " + REMOTE_NEWS + "/" + name, f)
            print("OK  " + REMOTE_NEWS + "/" + name)

    ensure_dir(ftp, REMOTE_NEWS + "/articles")
    upload_tree(ftp, os.path.join(LOCAL_ROOT, "articles"), REMOTE_NEWS + "/articles")

    ftp.quit()
    print("DONE")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("ERROR:", e, file=sys.stderr)
        sys.exit(1)
