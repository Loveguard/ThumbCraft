package dev.blockframe.dumper;

import java.io.*;
import java.lang.reflect.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/**
 * Exports every entity model the Minecraft client defines, exactly as the game bakes it.
 *
 * Run with the client jar and its libraries on the classpath:
 *   java -cp dumper-dir:client.jar:libs... dev.blockframe.dumper.ModelDumper names.properties out.json
 *
 * It must live in its own package: obfuscated Minecraft classes sit in the unnamed package of a jar
 * signed by Mojang, and the JVM refuses to mix signed and unsigned classes in one package.
 *
 * It calls LayerDefinitions.createRoots() (the game's own table of every model layer), bakes each
 * LayerDefinition into a ModelPart tree and writes parts, pivots, rotations and textured quads as JSON.
 * names.properties maps Mojang's names to the jar's obfuscated names for versions that are obfuscated;
 * any name not listed is used as-is (unobfuscated jars need no entries).
 */
public final class ModelDumper {
    private static Properties names = new Properties();

    private static String cls(String mojang) {
        return names.getProperty("class." + mojang, mojang);
    }

    private static String member(String owner, String mojang) {
        return names.getProperty("member." + owner + "." + mojang, mojang);
    }

    private static Field field(Class<?> c, String owner, String mojang) throws NoSuchFieldException {
        String name = member(owner, mojang);
        for (Class<?> k = c; k != null; k = k.getSuperclass()) {
            try {
                Field f = k.getDeclaredField(name);
                f.setAccessible(true);
                return f;
            } catch (NoSuchFieldException ignored) {
            }
        }
        throw new NoSuchFieldException(owner + "." + mojang + " (" + name + ")");
    }

    private static Field optionalField(Class<?> c, String owner, String mojang) {
        try {
            return field(c, owner, mojang);
        } catch (NoSuchFieldException e) {
            return null;
        }
    }

    private static Method noArgMethod(Class<?> c, String owner, String mojang) throws NoSuchMethodException {
        String name = member(owner, mojang);
        for (Method m : c.getDeclaredMethods()) {
            if (m.getName().equals(name) && m.getParameterCount() == 0) {
                m.setAccessible(true);
                return m;
            }
        }
        throw new NoSuchMethodException(owner + "." + mojang + "() (" + name + ")");
    }

    private static void tryStatic(String className, String method) {
        try {
            Class<?> c = Class.forName(cls(className));
            noArgMethod(c, className, method).invoke(null);
        } catch (Throwable t) {
            System.err.println("note: " + className + "." + method + " skipped: " + rootCause(t));
        }
    }

    /** Unwraps reflection/initializer wrappers so the real reason is reported. */
    private static Throwable rootCause(Throwable t) {
        Throwable c = t;
        while ((c instanceof InvocationTargetException || c instanceof ExceptionInInitializerError) && c.getCause() != null)
            c = c.getCause();
        return c;
    }

    private static void fail(String what, Throwable t) {
        Throwable c = rootCause(t);
        System.err.println("ERROR: " + what + ": " + c);
        for (Throwable x = c; x != null; x = x.getCause()) {
            if (x != c) System.err.println("Caused by: " + x);
            StackTraceElement[] st = x.getStackTrace();
            for (int i = 0; i < Math.min(12, st.length); i++) System.err.println("    at " + st[i]);
        }
        System.exit(3);
    }

    // ------------------------------------------------------------------ model part serialisation

    private static final String MP = "net.minecraft.client.model.geom.ModelPart";
    private static Field fx, fy, fz, fxRot, fyRot, fzRot, fxScale, fyScale, fzScale, fVisible, fCubes, fChildren;
    private static Field fPolygons, fVertices, fNormal, fPos, fU, fV, fVx, fVy, fVz;

    private static float f(Field fl, Object o, float dflt) throws IllegalAccessException {
        return fl == null ? dflt : fl.getFloat(o);
    }

    private static void num(StringBuilder sb, float v) {
        if (Float.isNaN(v) || Float.isInfinite(v)) v = 0;
        float r = Math.round(v * 10000f) / 10000f;
        if (r == (long) r) sb.append((long) r);
        else sb.append(r);
    }

    private static void str(StringBuilder sb, String s) {
        sb.append('"');
        for (char ch : s.toCharArray()) {
            if (ch == '"' || ch == '\\') sb.append('\\');
            if (ch < 0x20) sb.append(String.format("\\u%04x", (int) ch));
            else sb.append(ch);
        }
        sb.append('"');
    }

    private static float vec(Object v, String c) throws Exception {
        Field fl = v.getClass().getField(c); // org.joml.Vector3f is never obfuscated
        return fl.getFloat(v);
    }

    private static void writePart(StringBuilder sb, Object part) throws Exception {
        if (fx == null) {
            Class<?> c = part.getClass();
            fx = field(c, MP, "x");
            fy = field(c, MP, "y");
            fz = field(c, MP, "z");
            fxRot = field(c, MP, "xRot");
            fyRot = field(c, MP, "yRot");
            fzRot = field(c, MP, "zRot");
            fxScale = optionalField(c, MP, "xScale");
            fyScale = optionalField(c, MP, "yScale");
            fzScale = optionalField(c, MP, "zScale");
            fVisible = optionalField(c, MP, "visible");
            fCubes = field(c, MP, "cubes");
            fChildren = field(c, MP, "children");
        }
        sb.append("{\"pivot\":[");
        num(sb, fx.getFloat(part)); sb.append(',');
        num(sb, fy.getFloat(part)); sb.append(',');
        num(sb, fz.getFloat(part));
        sb.append("],\"rot\":[");
        num(sb, fxRot.getFloat(part)); sb.append(',');
        num(sb, fyRot.getFloat(part)); sb.append(',');
        num(sb, fzRot.getFloat(part));
        sb.append("],\"scale\":[");
        num(sb, f(fxScale, part, 1)); sb.append(',');
        num(sb, f(fyScale, part, 1)); sb.append(',');
        num(sb, f(fzScale, part, 1));
        sb.append("],\"visible\":").append(fVisible == null || fVisible.getBoolean(part));
        sb.append(",\"quads\":[");
        boolean firstQuad = true;
        for (Object cube : (List<?>) fCubes.get(part)) {
            if (fPolygons == null) fPolygons = field(cube.getClass(), MP + "$Cube", "polygons");
            for (Object poly : (Object[]) fPolygons.get(cube)) {
                if (poly == null) continue;
                if (fVertices == null) {
                    fVertices = field(poly.getClass(), MP + "$Polygon", "vertices");
                    fNormal = field(poly.getClass(), MP + "$Polygon", "normal");
                }
                if (!firstQuad) sb.append(',');
                firstQuad = false;
                Object n = fNormal.get(poly);
                sb.append("{\"n\":[");
                num(sb, vec(n, "x")); sb.append(',');
                num(sb, vec(n, "y")); sb.append(',');
                num(sb, vec(n, "z"));
                sb.append("],\"v\":[");
                boolean firstV = true;
                for (Object vert : (Object[]) fVertices.get(poly)) {
                    if (fU == null) {
                        Class<?> vc = vert.getClass();
                        String VX = MP + "$Vertex";
                        fPos = optionalField(vc, VX, "pos");
                        if (fPos == null) {
                            fVx = field(vc, VX, "x");
                            fVy = field(vc, VX, "y");
                            fVz = field(vc, VX, "z");
                        }
                        fU = field(vc, VX, "u");
                        fV = field(vc, VX, "v");
                    }
                    if (!firstV) sb.append(',');
                    firstV = false;
                    float x, y, z;
                    if (fPos != null) {
                        Object p = fPos.get(vert);
                        x = vec(p, "x");
                        y = vec(p, "y");
                        z = vec(p, "z");
                    } else {
                        x = fVx.getFloat(vert);
                        y = fVy.getFloat(vert);
                        z = fVz.getFloat(vert);
                    }
                    sb.append('[');
                    num(sb, x); sb.append(',');
                    num(sb, y); sb.append(',');
                    num(sb, z); sb.append(',');
                    num(sb, fU.getFloat(vert)); sb.append(',');
                    num(sb, fV.getFloat(vert));
                    sb.append(']');
                }
                sb.append("]}");
            }
        }
        sb.append("],\"children\":{");
        boolean firstChild = true;
        for (Map.Entry<?, ?> e : ((Map<?, ?>) fChildren.get(part)).entrySet()) {
            if (!firstChild) sb.append(',');
            firstChild = false;
            str(sb, String.valueOf(e.getKey()));
            sb.append(':');
            writePart(sb, e.getValue());
        }
        sb.append("}}");
    }

    public static void main(String[] args) throws Exception {
        if (args.length < 2) {
            System.err.println("usage: ModelDumper names.properties out.json");
            System.exit(2);
        }
        try (Reader r = Files.newBufferedReader(Paths.get(args[0]), StandardCharsets.UTF_8)) {
            names.load(r);
        }
        System.setProperty("java.awt.headless", "true");
        tryStatic("net.minecraft.SharedConstants", "tryDetectVersion");
        tryStatic("net.minecraft.server.Bootstrap", "bootStrap");

        String LDS = "net.minecraft.client.model.geom.LayerDefinitions";
        String LD = "net.minecraft.client.model.geom.builders.LayerDefinition";
        String MD = "net.minecraft.client.model.geom.builders.MaterialDefinition";
        Map<?, ?> roots = null;
        try {
            Class<?> layerDefs = Class.forName(cls(LDS));
            roots = (Map<?, ?>) noArgMethod(layerDefs, LDS, "createRoots").invoke(null);
        } catch (Throwable t) {
            fail("LayerDefinitions.createRoots() failed", t);
        }

        StringBuilder sb = new StringBuilder(1 << 22);
        sb.append("{\"layers\":{");
        int ok = 0;
        int failed = 0;
        boolean first = true;
        List<Map.Entry<?, ?>> entries = new ArrayList<>(roots.entrySet());
        entries.sort(Comparator.comparing(e -> String.valueOf(e.getKey())));
        for (Map.Entry<?, ?> e : entries) {
            String key = String.valueOf(e.getKey());
            Object def = e.getValue();
            try {
                Object root = noArgMethod(def.getClass(), LD, "bakeRoot").invoke(def);
                int tw = 64, th = 32;
                Field mat = optionalField(def.getClass(), LD, "material");
                if (mat != null) {
                    Object m = mat.get(def);
                    Field w = optionalField(m.getClass(), MD, "xTexSize");
                    Field h = optionalField(m.getClass(), MD, "yTexSize");
                    if (w != null && h != null) {
                        tw = w.getInt(m);
                        th = h.getInt(m);
                    }
                }
                StringBuilder part = new StringBuilder();
                writePart(part, root);
                if (!first) sb.append(',');
                first = false;
                str(sb, key);
                sb.append(":{\"texture\":[").append(tw).append(',').append(th).append("],\"root\":");
                sb.append(part).append('}');
                ok++;
            } catch (Throwable t) {
                failed++;
                System.err.println("skip " + key + ": " + rootCause(t));
            }
        }
        sb.append("}}");
        Files.write(Paths.get(args[1]), sb.toString().getBytes(StandardCharsets.UTF_8));
        System.out.println("dumped " + ok + " layers, " + failed + " failed");
    }
}
