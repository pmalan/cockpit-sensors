/*
 * cockpit-sensors - Hardware sensor display for cockpit
 */

(function () {
	"use strict";

	var POLL_INTERVAL = 5000;
	var refreshTimer = null;

	/* --- Read cockpit shell body colors and apply as inline styles --- */
	function syncTheme() {
		try {
			var parentBody = window.parent.document.body;
			if (parentBody) {
				var style = window.parent.getComputedStyle(paren
tBody);
				var bg = style.backgroundColor || '#ffffff';
				var fg = style.color               || '#151515';
				document.body.style.backgroundColor = bg;
				document.body.style.color           = fg;
			}
		} catch (e) {
			/* fallback */
		}
	}

	syncTheme(); // initial run
	setInterval(syncTheme, 2000); // poll every 2 s so iframe picks up theme
 toggles from shell

	function formatNumber(num) {
		if (num < 10 && num > -10) return Math.round(num * 100) / 100;
		return Math.round(num * 10) / 10;
	}

	function formatSigned(val) {
		return val >= 0 ? "+" + val : "" + val;
	}

	/* --- Sensor data helpers (mirrors test/spec/test-sensors.js logic) ---
 */

	function classifyChip(chipName) {
		if (chipName.indexOf("coretemp") >= 0) return "cpu";
		if (chipName.indexOf("nvme-pci") >= 0) return "nvme";
		if (chipName.indexOf("mlx5-pci") >= 0) return "nic";
		if (chipName.indexOf("pch_") === 0 || chipName.indexOf("acpitz")
 >= 0 || chipName.indexOf("virtual-") >= 0) return "chipset";
		if (chipName.indexOf("i2c") >= 0 && chipName.indexOf("gpu") >= 0
) return "gpu";
		return "";
	}

	function getDisplayName(chipKey) {
		if (chipKey.indexOf("coretemp") >= 0) {
			var num = chipKey.match(/coretemp-(\d+)/);
			if (num && num[1]) {
				var idStr = "";
				for (var i = num[1].length - 2 || 1; i < num[1].
length; i++) {
					idStr += num[1][i];
				}
				return "CPU" + (idStr ? parseInt(idStr, 16) : ""
);
			}
			return "CPU";
		}
		if (chipKey.indexOf("nvme-pci") >= 0) {
			var id = chipKey.match(/nvme-pci-(.+)$/);
			return "NVMe-" + (id ? id[1] : "");
		}
		if (chipKey.indexOf("mlx5-pci") >= 0) return "NIC";
		if (chipKey.indexOf("pch_") === 0) return "Chipset";
		if (chipKey.indexOf("acpitz") >= 0) return "ACPI";
		if (chipKey.indexOf("virtual-") === 0) return "Virtual";
		return chipKey.replace(/_/g, " ");
	}

	function escapeHtml(str) {
		if (typeof document === "undefined") return str;
		var div = document.createElement("div");
		div.appendChild(document.createTextNode(str));
		return div.innerHTML;
	}

	function findValue(chipData, part, suffix) {
		for (var key in chipData) {
			if (key.indexOf(part + suffix) === 0) {
				var v = parseFloat(chipData[key]);
				return isFinite(v) ? v : null;
			}
		}
		return null;
	}

	function buildStatus(chipData, inputKey, value) {
		var part = inputKey.replace("_input", "");

		// Check alarm bits (priority over thresholds)
		for (var key in chipData) {
			if (key.indexOf(part + "_crit_alarm") === 0 && chipData[
key] > 0) return "critical";
			if (key.indexOf(part + "_high_alarm") === 0 && chipData[
key] > 0) return "warning";
			if (key.indexOf(part + "_max_alarm") === 0 && chipData[k
ey] > 0) return "warning";
		}

		// Check critical threshold
		var critKey = findValue(chipData, part, "_crit");
		if (critKey !== null && critKey > 0 && value > 0) {
			var numPart = part.replace(/\d+$/, "");
			if (numPart === "temp") {
				if (value >= critKey * 0.98) return "critical";
			}
		} else if (critKey !== null && critKey > 0 && value < -1) {
			var numPart = part.replace(/\d+$/, "");
			if (numPart === "temp" && value <= critKey * 0.98) retur
n "critical";
		}

		// Check max threshold for warning
		var maxKey = findValue(chipData, part, "_max");
		if (maxKey !== null && maxKey > 0 && value > 0) {
			var numPart2 = part.replace(/\d+$/, "");
			if (numPart2 === "temp") {
				if (value >= maxKey * 0.95) return "warning";
			}
		}

		// Check highest threshold exceeded for temp sensors
		var highKey = findValue(chipData, part, "_highest");
		if (highKey !== null && highKey > 0 && isFinite(value)) {
			var numPart3 = part.replace(/\d+$/, "");
			if (numPart3 === "temp") {
				if (isFinite(critKey) && value < critKey && valu
e >= maxKey * 0.9) return "warning";
			}
		}

		return "ok";
	}

	function buildSensorLines(sensors) {
		var lines = [];
		if (!sensors || typeof sensors !== "object") return lines;

		for (var chipName in sensors) {
			var chipData = sensors[chipName];
			if (!chipData || typeof chipData !== "object") continue;

			for (var label in chipData) {
				if (typeof chipData[label] !== "object") continu
e;

				for (var key in chipData[label]) {
					// Only process _input keys ending corre
ctly
					if (key.indexOf("_input") !== key.length
 - 6) continue;

					var value = parseFloat(chipData[label][k
ey]);
					if (!isFinite(value) || value === 0) con
tinue;

					var part = key.replace("_input", "");
					var isTemp = (part.indexOf("temp") === 0
 && part.length > 4);
					var unit = "\u00B0C";
					var statusClass = buildStatus(chipData[l
abel], key, value);

					if (!isTemp) {
						// Voltage sensor: check min/max
 thresholds
						for (var k2 in chipData[label]) 
{
							if (k2.indexOf(part + "_
min") === 0) {
								var vmin = parse
Float(chipData[label][k2]);
								if (isFinite(vmi
n) && vmin > 0 && value <= vmin * 1.05) statusClass = "warning";
							}
							if (k2.indexOf(part + "_
max") === 0) {
								var vmax = parse
Float(chipData[label][k2]);
								if (isFinite(vma
x) && vmax > 0 && value >= vmax * 0.95) statusClass = "critical";
							}
						}
						unit = " V";
					}

					// Build one row per sensor key as a tab
le row with threshold info
					var displayChip = chipName.replace(/_/g,
 ' ');
					var threshold = '';
					lines.push({ sortKey: displayChip, html:
'<tr class="sensor-line">' +
						'<td><span class="chip-name">' +
 escapeHtml(displayChip) + '</span></td>' +
						'<td><span class="sensor-name">'
 + escapeHtml(label) + '</span></td>' +
						'<td><span class="sensor-value '
 + statusClass + '">' + formatSigned(formatNumber(value)) + unit + '</span> ' + 
threshold + '</td>' +
						'<td><span class="sensor-status 
' + statusClass + '">' + getStatusIcon(statusClass) + '</span></td>' +
					'</tr>' });
				}
			}
		}

		return lines;
	}

	function getStatusIcon(statusClass) {
		if (statusClass === "critical") return ' <span class="sensor-sta
tus critical">\u26A0</span>';
		if (statusClass === "warning") return ' <span class="sensor-stat
us warning">\u26A1</span>';
		if (statusClass === "ok") return ' <span class="sensor-status ok
">🟢</span>';
	}

	/* --- Rendering --- */

	function renderSensors(sensors) {
		var tbody = document.getElementById("sensor-body");
		if (!sensors) return;

		var rows = buildSensorLines(sensors);
		rows.sort(function(a, b) {
			return a.sortKey.localeCompare(b.sortKey, undefined, { s
ensitivity: 'base' });
		});
		tbody.innerHTML = rows.map(function(r) { return r.html; }).join(
'\n');
	}

	function parseSensors(data) {
		try {
			return typeof data === "string" ? JSON.parse(data) : dat
a;
		} catch (e) {
			console.error("Parse error:", e);
			return null;
		}
	}

	/* --- Data fetching --- */

	function fetchSensors() {
		if (typeof cockpit === "undefined") return;

		statusLine = document.getElementById("status-line");
		if (statusLine) {
			statusLine.className = "sensor-status-line status-loadin
g";
			statusLine.textContent = "Loading sensors ...";
		}

		cockpit.spawn(["/usr/bin/sensors", "-j"], {
			environment: ["PATH=/usr/bin:/bin:/usr/sbin:/sbin", "HOM
E=/tmp"],
			buffer: true
		}).done(function (data) {
			var json = parseSensors(data);
			if (json) {
				renderSensors(json);
			} else {
				var sl = document.getElementById("status-line");
				if (sl) {
					sl.textContent = "Failed to parse sensor
 data.";
				}
			}
		}).fail(function (err) {
			console.error("spawn failed:", JSON.stringify(err));
			var sl = document.getElementById("status-line");
			if (sl) {
				sl.className = "sensor-status-line";
				sl.textContent = "Error: " + (err.message || err
.code || err.statusText || JSON.stringify(err) || "not-found") + " — check that 
lm-sensors is installed.";
			}
		}).always(function () {
			// Reset cooldown once the request completes or fails
			cooldown = false;
		});
	}

	/* --- Init / polling --- */

	var statusLine;
	var cooldown = false;

	function init() {
		if (typeof cockpit !== "undefined") {
			if (!refreshTimer && !cooldown) {
				cooldown = true;
				fetchSensors();
				refreshTimer = setInterval(function () { refresh
Timer = null; fetchSensors(); }, POLL_INTERVAL);
			}
		} else {
			// cockpit.js hasn't loaded yet — retry
			setTimeout(init, 200);
		}
	}

	init();

})();
