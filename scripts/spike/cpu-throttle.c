// SPIKE: emulate a CPU `rate` times slower for every Chromium renderer process
// under a browser pid, main thread and workers alike (DevTools'
// Emulation.setCPUThrottlingRate only slows a page's main thread, and is
// refused on worker targets). Each period, renderers run for period/rate and
// are stopped (SIGSTOP) for the rest. Renderers are re-scanned every 100 ms.
// build: gcc -O2 -o cpu-throttle cpu-throttle.c
// usage: cpu-throttle <browserPid> <rate> [periodMs=10]
#include <dirent.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

static int pids[256];
static int npids;

static int parent_of(int pid) {
	char path[64], buf[512];
	snprintf(path, sizeof path, "/proc/%d/stat", pid);
	FILE *f = fopen(path, "r");
	if (!f) return -1;
	int ppid = -1;
	if (fgets(buf, sizeof buf, f)) {
		char *p = strrchr(buf, ')');
		if (p) sscanf(p + 2, "%*c %d", &ppid);
	}
	fclose(f);
	return ppid;
}

static int is_renderer(int pid) {
	char path[64], buf[4096];
	snprintf(path, sizeof path, "/proc/%d/cmdline", pid);
	FILE *f = fopen(path, "r");
	if (!f) return 0;
	size_t n = fread(buf, 1, sizeof buf - 1, f);
	fclose(f);
	for (size_t i = 0; i < n; i++) if (!buf[i]) buf[i] = ' ';
	buf[n] = 0;
	return strstr(buf, "--type=renderer") != NULL;
}

static int descends_from(int pid, int root) {
	for (int i = 0; i < 8 && pid > 1; i++) {
		pid = parent_of(pid);
		if (pid == root) return 1;
	}
	return 0;
}

static void scan(int root) {
	DIR *d = opendir("/proc");
	struct dirent *e;
	npids = 0;
	while ((e = readdir(d)) && npids < 256) {
		int pid = atoi(e->d_name);
		if (pid > 0 && is_renderer(pid) && descends_from(pid, root)) pids[npids++] = pid;
	}
	closedir(d);
}

static void sleep_us(long us) {
	struct timespec ts = {us / 1000000, (us % 1000000) * 1000};
	nanosleep(&ts, NULL);
}

static void sig_all(int sig) {
	for (int i = 0; i < npids; i++) kill(pids[i], sig);
}

static volatile int running = 1;
static void stop(int s) { (void)s; running = 0; }

int main(int argc, char **argv) {
	if (argc < 3) return 2;
	int root = atoi(argv[1]);
	double rate = atof(argv[2]);
	long period = (argc > 3 ? atol(argv[3]) : 10) * 1000;
	long on = (long)(period / rate), off = period - on;
	signal(SIGTERM, stop);
	signal(SIGINT, stop);
	long cycles = 0;
	while (running && kill(root, 0) == 0) {
		if (cycles++ % 10 == 0) scan(root);
		sig_all(SIGCONT);
		sleep_us(on);
		if (rate > 1) {
			sig_all(SIGSTOP);
			sleep_us(off);
		}
	}
	sig_all(SIGCONT);
	return 0;
}
