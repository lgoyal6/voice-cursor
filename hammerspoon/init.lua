-- Voice Cursor · Hammerspoon integration
--
-- Install:
--   1. brew install --cask hammerspoon
--   2. Open Hammerspoon.app, grant Accessibility permission
--   3. ln -s "$(pwd)/hammerspoon/init.lua" ~/.hammerspoon/init.lua
--   4. Reload from the Hammerspoon menu bar icon
--
-- Set these at the top of ~/.hammerspoon/init.lua or via env:
--   export VC_DASHBOARD_URL=http://localhost:3000
--   export VC_CONVEX_SITE_URL=https://<your-deployment>.convex.site

local DASHBOARD_URL = os.getenv("VC_DASHBOARD_URL") or "http://localhost:3000"
local CONVEX_SITE_URL = os.getenv("VC_CONVEX_SITE_URL") or ""

----------------------------------------------------------------------
-- Hotkey: ⌘⇧V — Quick-add via Voice Cursor
--   Opens the dashboard, focuses the dictation textarea, notifies the
--   user to speak. Voice Cursor (running in the menu bar) transcribes
--   the audio into the focused field; the dashboard's #vc-dump bridge
--   then submits it to Convex.
----------------------------------------------------------------------
hs.hotkey.bind({ "cmd", "shift" }, "V", function()
  hs.execute("/usr/bin/open '" .. DASHBOARD_URL .. "?dictate=1'")
  hs.timer.doAfter(0.4, function()
    hs.notify
      .new({
        title = "Voice Cursor",
        informativeText = "Listening — speak your brain dump",
        soundName = "Pop",
      })
      :send()
  end)
end)

----------------------------------------------------------------------
-- Hotkey: ⌘⇧T — Surface the current top task
----------------------------------------------------------------------
hs.hotkey.bind({ "cmd", "shift" }, "T", function()
  fetchTopTask(function(top)
    if not top then
      hs.notify
        .new({ title = "Voice Cursor", informativeText = "No open tasks." })
        :send()
      return
    end
    hs.notify
      .new({
        title = string.format("Top task · %s", string.upper(top.priority)),
        informativeText = top.title,
        soundName = "Glass",
      })
      :send()
  end)
end)

----------------------------------------------------------------------
-- Background poll: every 60s, surface new top task if it changed.
----------------------------------------------------------------------
local lastTopTitle = nil

function fetchTopTask(cb)
  if CONVEX_SITE_URL == "" then
    cb(nil)
    return
  end
  hs.http.asyncGet(CONVEX_SITE_URL .. "/top-task", nil, function(status, body)
    if status == 204 or status >= 400 or not body or body == "" then
      cb(nil)
      return
    end
    local ok, parsed = pcall(hs.json.decode, body)
    if not ok or not parsed or not parsed.top then
      cb(nil)
      return
    end
    cb(parsed.top)
  end)
end

if CONVEX_SITE_URL ~= "" then
  hs.timer.doEvery(60, function()
    fetchTopTask(function(top)
      if not top then return end
      if top.title ~= lastTopTitle then
        lastTopTitle = top.title
        hs.notify
          .new({
            title = "New top task",
            informativeText = top.title,
            soundName = "Tink",
          })
          :send()
      end
    end)
  end)
end

hs.alert.show("Voice Cursor · Hammerspoon loaded")
