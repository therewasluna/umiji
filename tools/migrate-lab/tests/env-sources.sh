# Source settings for each lab panel: src <name> exports SRC_* for migrate.mjs.
src() {
    unset SRC_USER SRC_PASS SRC_TOKEN SRC_SECRET SRC_INSECURE TARGET_SQUAD
    case $1 in
        marzban) export SRC_TYPE=marzban SRC_URL=https://127.0.0.1:18001 SRC_USER=admin SRC_PASS=AdminPass123 SRC_INSECURE=1 ;;
        pasarguard) export SRC_TYPE=pasarguard SRC_URL=https://127.0.0.1:18002 SRC_USER=admin SRC_PASS='AdminPass123!' SRC_INSECURE=1 ;;
        marzneshin) export SRC_TYPE=marzneshin SRC_URL=https://127.0.0.1:18003 SRC_USER=admin SRC_PASS=AdminPass123 SRC_INSECURE=1 ;;
        3x-ui) export SRC_TYPE=3x-ui SRC_URL=http://127.0.0.1:18004 SRC_USER=admin SRC_PASS=AdminPass123 ;;
        3x-ui-2) export SRC_TYPE=3x-ui SRC_URL=http://127.0.0.1:18007 SRC_USER=admin SRC_PASS=AdminPass123 ;;
        remnawave) export SRC_TYPE=remnawave SRC_URL=http://127.0.0.1:18005 SRC_TOKEN=$(cat "$LAB/rw.token") ;;
        hiddify) export SRC_TYPE=hiddify SRC_URL=http://127.0.0.1:18006/dEJc7Q9F8vWUPLMVbzSnr479oGZOqy/ad0519b5-bf19-4ec5-a266-8b9fd6ffd9df/ ;;
    esac
}
