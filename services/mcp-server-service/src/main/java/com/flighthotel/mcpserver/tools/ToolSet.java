package com.flighthotel.mcpserver.tools;

import java.util.List;

/** A group of tools (customer, catalogue, admin, hotel manager, support). Each group is a Spring bean. */
public interface ToolSet {

    List<ToolDefinition> tools();
}
