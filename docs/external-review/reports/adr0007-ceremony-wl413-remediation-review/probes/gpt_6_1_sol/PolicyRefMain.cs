using System;
using Xuux.TpmCeremony.Probes;
public static class PolicyRefMain {
    public static void Main() {
        Console.WriteLine("{\"layouts\":"+PolicyRefProbe.Layouts()+",\"run\":"+PolicyRefProbe.Run("127.0.0.1",2101)+"}");
    }
}
