using System;
using Xuux.TpmCeremony;
using Xuux.TpmHost.Tests;

public static class HostGuardProbe
{
    public static int Main()
    {
        RecordingTransport recording = new RecordingTransport();
        recording.Submit(Cmd.GetCapability(6, 0x105, 5));
        recording.Submit(Cmd.NvReadPublic(0x01800000));
        Console.WriteLine("{\"guardAccepted\":[\"GetCapability\",\"NV_ReadPublic\"],\"recordingSubmittedCount\":"
            + recording.SubmittedCount + ",\"recordingReachedCount\":" + recording.Reached.Count + "}");
        return 0;
    }
}
