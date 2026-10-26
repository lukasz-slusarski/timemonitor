#!/usr/bin/env python3
"""Hook Claude Code → zakładka Biuro w monitor.important.is. Nigdy nie blokuje pracy.

Raportuje tylko sesje z folderów w opcji `roots`. Nie wysyła treści promptów ani wyników
narzędzi: tylko zdarzenie, rodzaj czynności, folder i tytuł ustawiony przez Claude (biuro-doing).
Opcje pluginu przychodzą jako CLAUDE_PLUGIN_OPTION_*; bez pluginu z ~/.config/biuro/config.json.
"""
import json, os, subprocess, sys, time

HOME = os.path.expanduser('~')
CACHE = os.path.join(HOME, '.cache', 'biuro')

cfg = {'url': 'https://monitor.important.is', 'token': '', 'roots': '~/important,~/Projects/important'}
try:
    cfg.update(json.load(open(os.path.join(HOME, '.config', 'biuro', 'config.json'))))
except Exception:
    pass
for key in ('url', 'token', 'roots'):
    if os.environ.get('CLAUDE_PLUGIN_OPTION_' + key.upper()):
        cfg[key] = os.environ['CLAUDE_PLUGIN_OPTION_' + key.upper()]
ROOTS = cfg['roots'] if isinstance(cfg['roots'], list) else [r.strip() for r in cfg['roots'].split(',') if r.strip()]

VERBS = [
    (('Edit', 'Write', 'MultiEdit', 'NotebookEdit'), 'pisze'),
    (('Read', 'Grep', 'Glob', 'LS'), 'czyta pliki'),
    (('Bash',), 'uruchamia komendy'),
    (('WebSearch', 'WebFetch'), 'szuka w sieci'),
    (('Agent', 'Task'), 'deleguje agentowi'),
    (('Skill',), 'używa skilla'),
]


def verb(tool):
    if tool.startswith('mcp__'):
        return 'korzysta z ' + tool.split('__')[1]
    for names, v in VERBS:
        if tool in names:
            return v
    return 'pracuje'


def project_of(cwd):
    # w folderach important projekt to podfolder (clientportal); w folderach klientów z prefiksem klienta (wdf / arek)
    for root in ROOTS:
        root = os.path.expanduser(root).rstrip('/')
        name = os.path.basename(root)
        if cwd == root:
            return name
        if cwd.startswith(root + '/'):
            sub = cwd[len(root) + 1:].split('/')[0]
            return sub if name == 'important' else f'{name} / {sub}'
    return None


def send(payload):
    if not cfg['token']:
        return
    # token idzie przez stdin curla (-H @-), żeby nie był widoczny w liście procesów
    proc = subprocess.Popen(
        ['curl', '-s', '-m', '3', '-o', '/dev/null', '-X', 'POST', '-H', 'content-type: application/json',
         '-H', '@-', '--data-binary', json.dumps(payload), cfg['url'].rstrip('/') + '/api/presence/events'],
        stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    proc.stdin.write(('authorization: Bearer ' + cfg['token'] + '\n').encode())
    proc.stdin.close()


def throttled(sid, key, seconds):
    f = os.path.join(CACHE, f'{sid}.last')
    try:
        last_key, last_ts = open(f).read().split('|')
        if last_key == key and time.time() - float(last_ts) < seconds:
            return True
    except Exception:
        pass
    open(f, 'w').write(f'{key}|{time.time()}')
    return False


def pending(sid):
    # tytuł zapisany przez biuro-doing czeka na najbliższe zdarzenie
    f = os.path.join(CACHE, f'{sid}.pending.json')
    try:
        p = json.load(open(f))
        os.remove(f)
        return p
    except Exception:
        return None


def main():
    try:
        ev = json.load(sys.stdin)
    except Exception:
        return
    name = ev.get('hook_event_name', '')
    sid = ev.get('session_id', '')
    project = project_of(ev.get('cwd', ''))
    if not sid or project is None:
        return
    os.makedirs(CACHE, exist_ok=True)

    p = {'session_id': sid, 'source': 'claude', 'project': project}
    doing = pending(sid)

    if name == 'SessionStart':
        p.update(event='start', status='idle', activity='otworzył sesję')
    elif name == 'UserPromptSubmit':
        p.update(status='working', activity='myśli', human=True)
        if not os.path.exists(os.path.join(CACHE, f'{sid}.title')):
            # stdout UserPromptSubmit trafia do kontekstu Claude: prośba o tytuł dla zespołu
            print(f"BIURO: ta sesja nie ma jeszcze tytułu na monitorze zespołu. Gdy wiesz, czego dotyczy praca, "
                  f"ustaw go (i zmień, gdy zadanie się zmieni): biuro-doing --session {sid} 'Krótki tytuł' "
                  f"'Jedno zdanie, co robisz'. Opcjonalnie --task <id zadania ClickUp>. Bez haseł, kwot i danych osobowych.")
    elif name in ('PreToolUse', 'PostToolUse'):
        tool = ev.get('tool_name', '')
        if 'biuro-doing' in json.dumps(ev.get('tool_input', {})):
            if not doing:
                return
        elif name == 'PostToolUse' or throttled(sid, tool, 20):
            if not doing:
                return
        else:
            p.update(status='working', activity=verb(tool))
    elif name == 'SubagentStart':
        p.update(status='working', subagent_start={'id': ev.get('agent_id', ''), 'type': ev.get('agent_type', 'agent')})
    elif name == 'SubagentStop':
        p.update(subagent_stop=ev.get('agent_id', ''))
    elif name == 'Notification':
        # na czerwono tylko prośba o zgodę; koniec tury to zwykła przerwa, nie blokada
        if ev.get('notification_type') == 'permission_prompt':
            p.update(status='waiting', activity='czeka na decyzję')
        elif not doing:
            return
    elif name == 'Stop':
        p.update(status='idle', activity='skończył turę')
    elif name == 'SessionEnd':
        p.update(event='end')
    elif not doing:
        return
    if doing:
        p.update(doing)
    send(p)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
