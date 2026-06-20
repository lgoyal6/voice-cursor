require("hs.ipc")

function dictateClip(path)
  hs.timer.doAfter(0, function()
    hs.application.launchOrFocus("Notion")
    hs.timer.usleep(300000)
    local rcmd = 54
    hs.eventtap.event.newKeyEvent(rcmd, true):post()
    hs.timer.usleep(400000)
    hs.execute("/usr/bin/afplay '" .. path .. "'")
    hs.timer.usleep(400000)
    hs.eventtap.event.newKeyEvent(rcmd, false):post()
  end)
end