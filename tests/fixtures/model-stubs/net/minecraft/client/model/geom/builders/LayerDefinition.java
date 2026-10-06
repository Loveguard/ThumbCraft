package net.minecraft.client.model.geom.builders;

import net.minecraft.client.model.geom.ModelPart;

public class LayerDefinition {
    private final MaterialDefinition material;
    private final java.util.function.Supplier<ModelPart> baker;

    public LayerDefinition(MaterialDefinition material, java.util.function.Supplier<ModelPart> baker) {
        this.material = material;
        this.baker = baker;
    }

    public ModelPart bakeRoot() {
        return baker.get();
    }
}
