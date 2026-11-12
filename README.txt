head=3075587a72e59e7bc0846d8817130f696e72651e
ci_run=https://github.com/ovvvog/xuux/actions/runs/43173999867
local: XUUX_TEST_NO_ROOT_WORKER=1 (owner: no root worker on this host); RLIMIT_NOFILE raised for the test shell only via prlimit (host hard limit 4096)
mutant: scripts/worker.mjs with the old 0..4095 scan and >=4096 rejection -> ISO-54/55/56 fail
