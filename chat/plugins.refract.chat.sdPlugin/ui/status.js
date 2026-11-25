/*
 * The line at the foot of every property inspector saying whether the plugin
 * has found the Refract desktop app, and what to do when it has not.
 * The plugin answers "getStatus" and sends "status" again whenever it changes.
 */
(function () {
	const { streamDeckClient } = SDPIComponents;
	const line = document.getElementById("status");
	if (!line) return;

	function describe(status) {
		if (status.connected) {
			if (!status.signedIn) return ["warn", "Refract is open, but nobody is signed in."];
			const version = status.appVersion ? " " + status.appVersion : "";
			return ["ok", "Connected to Refract" + version + (status.call ? ", in " + status.call + "." : ".")];
		}
		switch (status.reason) {
			case "incompatible":
				return ["warn", "This Refract speaks a different version of local control. Update Refract and this plugin."];
			case "rejected":
			case "unreachable":
				return ["warn", "Refract is not answering. Trying again…"];
			default:
				return [
					"off",
					"Refract was not found. Open the Refract desktop app and turn on Settings → Desktop App → Stream Deck Control.",
				];
		}
	}

	function show(status) {
		const [kind, text] = describe(status);
		line.dataset.kind = kind;
		line.querySelector("span").textContent = text;
		line.hidden = false;
	}

	streamDeckClient.sendToPropertyInspector.subscribe(function (message) {
		const payload = message && message.payload;
		if (payload && payload.event === "status") show(payload);
	});
	streamDeckClient.send("sendToPlugin", { event: "getStatus" });
})();
